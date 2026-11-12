import { setTimeout as delay } from "node:timers/promises";
import dbus, { type Message, type MessageBus, type MessageLike, type Variant } from "dbus-next";
import { abortable } from "./abort.ts";
import { requestFrame, type ConnectStation } from "./client.ts";
import { DEVICE_INFO, verifyDevice } from "./protocol.ts";

const BLUEZ = "org.bluez";
const ADAPTER = "org.bluez.Adapter1";
const DEVICE = "org.bluez.Device1";
const SERVICE = "org.bluez.GattService1";
const CHARACTERISTIC = "org.bluez.GattCharacteristic1";
const DBUS = "org.freedesktop.DBus";
const PROPERTIES = `${DBUS}.Properties`;
const uuid = (short: string) => `0000${short}-0000-1000-8000-00805f9b34fb`;

type Properties = Record<string, Variant<unknown>>;
type ManagedObjects = Record<string, Record<string, Properties>>;

export class BluezConnection {
  private readonly bus: MessageBus = dbus.systemBus();
  private readonly disconnected = new AbortController();
  private owner = "";
  private device = "";
  private connectedHere = false;
  private notify = "";
  private writePath = "";
  private writeType: "request" | "command" = "request";

  constructor() {
    this.bus.on("error", (error: Error) => this.disconnected.abort(error));
    this.bus.on("message", this.onDeviceSignal);
  }

  get signal(): AbortSignal {
    return this.disconnected.signal;
  }

  private onDeviceSignal = (message: Message) => {
    if (!this.isPropertyChange(message, this.device, DEVICE)) return;
    const changed = message.body[1] as Properties;
    if (changed.Connected?.value === false) {
      this.disconnected.abort(new Error("Marstek BLE device disconnected"));
    }
  };

  private isPropertyChange(message: Message, path: string, iface: string) {
    return message.type === dbus.MessageType.SIGNAL &&
      message.sender === this.owner && message.path === path &&
      message.interface === PROPERTIES && message.member === "PropertiesChanged" &&
      message.body[0] === iface;
  }

  private async call(message: MessageLike, signal: AbortSignal) {
    signal.throwIfAborted();
    try {
      return await abortable(this.bus.call(new dbus.Message({ destination: BLUEZ, ...message })), signal);
    } catch (error) {
      if (error instanceof Error && error.name === "DBusError") {
        Object.assign(error, { dbusInterface: message.interface, dbusMethod: message.member });
      }
      throw error;
    }
  }

  private async objects(signal: AbortSignal): Promise<ManagedObjects> {
    const reply = await this.call({
      path: "/",
      interface: `${DBUS}.ObjectManager`,
      member: "GetManagedObjects",
    }, signal);
    return reply?.body[0] as ManagedObjects;
  }

  private async discover(adapter: string, address: string, signal: AbortSignal) {
    const findDevice = (objects: ManagedObjects) => Object.keys(objects).find((path) => {
      const device = objects[path][DEVICE];
      return device?.Adapter?.value === adapter &&
        String(device.Address?.value).toLowerCase() === address;
    });
    const initial = await this.objects(signal);
    if (initial[adapter]?.[ADAPTER]?.Powered?.value !== true) {
      throw new Error(`BlueZ adapter ${adapter} is missing or powered off`);
    }
    const known = findDevice(initial);
    if (known) return known;

    await this.call({
      path: adapter, interface: ADAPTER, member: "SetDiscoveryFilter",
      signature: "a{sv}", body: [{ Transport: new dbus.Variant("s", "le") }],
    }, signal);
    try {
      await this.call({ path: adapter, interface: ADAPTER, member: "StartDiscovery" }, signal);
      for (;;) {
        const found = findDevice(await this.objects(signal));
        if (found) return found;
        await delay(250, undefined, { signal });
      }
    } finally {
      await this.cleanupCall({ path: adapter, interface: ADAPTER, member: "StopDiscovery" });
    }
  }

  async open(adapterName: string, address: string, parentSignal: AbortSignal) {
    const signal = AbortSignal.any([parentSignal, this.signal, AbortSignal.timeout(20_000)]);
    const name = await this.call({
      destination: DBUS, path: "/org/freedesktop/DBus", interface: DBUS,
      member: "GetNameOwner", signature: "s", body: [BLUEZ],
    }, signal);
    this.owner = name?.body[0] as string;
    this.device = await this.discover(`/org/bluez/${adapterName}`, address, signal);
    const device = (await this.objects(signal))[this.device]?.[DEVICE];
    await this.call({
      destination: DBUS, path: "/org/freedesktop/DBus", interface: DBUS, member: "AddMatch",
      signature: "s",
      body: [`type='signal',sender='${BLUEZ}',interface='${PROPERTIES}',member='PropertiesChanged',path_namespace='${this.device}'`],
    }, signal);
    if (device?.Connected?.value !== true) {
      this.connectedHere = true;
      await this.call({ path: this.device, interface: DEVICE, member: "Connect" }, signal);
    }

    let objects = await this.objects(signal);
    while (objects[this.device]?.[DEVICE]?.ServicesResolved?.value !== true) {
      await delay(250, undefined, { signal });
      objects = await this.objects(signal);
    }
    const service = Object.keys(objects).find((path) => {
      const properties = objects[path][SERVICE];
      return properties?.Device?.value === this.device && properties.UUID?.value === uuid("ff00");
    });
    if (!service) throw new Error("Marstek GATT service FF00 was not found");

    const characteristic = (id: string) => Object.keys(objects).find((path) => {
      const properties = objects[path][CHARACTERISTIC];
      return properties?.Service?.value === service && properties.UUID?.value === uuid(id);
    });
    const write = characteristic("ff01");
    const notify = characteristic("ff02");
    if (!write || !notify) throw new Error("Marstek GATT characteristics FF01 and FF02 were not found");
    const flags = objects[write][CHARACTERISTIC].Flags?.value as string[] | undefined;
    if (!flags?.includes("write")) {
      if (!flags?.includes("write-without-response")) throw new Error("Marstek FF01 is not writable");
      this.writeType = "command";
    }
    this.writePath = write;
    this.notify = notify;
    await this.call({ path: notify, interface: CHARACTERISTIC, member: "StartNotify" }, signal);
  }

  onBytes(receive: (bytes: Buffer) => void) {
    const handler = (message: Message) => {
      if (!this.isPropertyChange(message, this.notify, CHARACTERISTIC)) return;
      const value = (message.body[1] as Properties).Value?.value;
      if (Buffer.isBuffer(value)) receive(value);
      else if (Array.isArray(value)) receive(Buffer.from(value));
    };
    this.bus.on("message", handler);
    return () => { this.bus.off("message", handler); };
  }

  async write(bytes: Buffer, signal: AbortSignal) {
    await this.call({
      path: this.writePath, interface: CHARACTERISTIC, member: "WriteValue",
      signature: "aya{sv}", body: [bytes, { type: new dbus.Variant("s", this.writeType) }],
    }, signal);
  }

  private async cleanupCall(message: MessageLike) {
    try {
      await this.call(message, AbortSignal.timeout(1_000));
    } catch {
      // BlueZ releases this client's subscriptions when the D-Bus connection closes.
    }
  }

  async close() {
    if (this.notify) {
      await this.cleanupCall({ path: this.notify, interface: CHARACTERISTIC, member: "StopNotify" });
    }
    if (this.connectedHere) {
      await this.cleanupCall({ path: this.device, interface: DEVICE, member: "Disconnect" });
    }
    this.bus.disconnect();
  }
}

export function bluezConnector(adapter: string): ConnectStation {
  if (!/^hci\d+$/.test(adapter)) throw new Error("BLE_ADAPTER must be an adapter name such as hci0");
  return async (station, signal) => {
    const connection = new BluezConnection();
    try {
      await connection.open(adapter, station.bleMac, signal);
      verifyDevice(await requestFrame(connection, DEVICE_INFO, signal), station);
      return connection;
    } catch (error) {
      await connection.close();
      throw error;
    }
  };
}
