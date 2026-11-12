import assert from "node:assert/strict";
import test from "node:test";
import { bluezConnector } from "../src/server/marstek/bluez.ts";
import { requestFrame } from "../src/server/marstek/client.ts";
import {
  decodeState, decodeUpsEnabled, DEVICE_INFO, FrameDecoder, GET_WORK_MODE_SETTINGS, readCommand, STATE, verifyDevice,
} from "../src/server/marstek/protocol.ts";

test("loads the BlueZ connector in Node.js", () => {
  assert.equal(typeof bluezConnector("hci0"), "function");
});

function responseFrame(command: number, payload: Buffer, transition = false) {
  const header = transition
    ? Buffer.from([0x73, (payload.length + 6) >> 8, (payload.length + 6) & 0xff, 0x23, command])
    : Buffer.from([0x73, payload.length + 5, 0x23, command]);
  const body = Buffer.concat([header, payload]);
  return Buffer.concat([body, Buffer.from([body.reduce((xor, byte) => xor ^ byte, 0)])]);
}

test("assembles normal and transition frames and skips a bad checksum", () => {
  const decoder = new FrameDecoder();
  const info = Buffer.from("type=VNSE3-0,id=test-device,dev_ver=150");
  const normal = responseFrame(DEVICE_INFO, info);
  const state = Buffer.alloc(139, 42);
  const transition = responseFrame(STATE, state, true);
  const corrupt = Buffer.from(normal);
  corrupt[corrupt.length - 1] ^= 1;
  assert.deepEqual(decoder.push(Buffer.concat([Buffer.from([0, 1]), normal.subarray(0, 2)])), []);
  assert.deepEqual(decoder.push(normal.subarray(2, 17)), []);
  assert.deepEqual(
    decoder.push(Buffer.concat([normal.subarray(17), corrupt, transition])),
    [{ command: DEVICE_INFO, payload: info }, { command: STATE, payload: state }],
  );
});

test("verifies Marstek identity and EMS profile", () => {
  const station = {
    id: "test-station", name: "Test", model: "VNSE3-0",
    deviceId: "test-device", bleMac: "02:00:00:00:00:01",
  };
  const info = Buffer.from("type=VNSE3-0,id=TEST-DEVICE,dev_ver=150\0");
  assert.doesNotThrow(() => verifyDevice(info, station));
  assert.throws(() => verifyDevice(info, { ...station, deviceId: "different" }), /differs/);
  assert.throws(() => verifyDevice(Buffer.from("type=VNSE3-0,id=test-device,dev_ver=151"), station), /Unsupported/);
});

test("normalizes the VNSE3 telemetry layout and preserves zeros", () => {
  const payload = Buffer.alloc(139);
  payload.writeInt16LE(468, 2);
  payload[4] = 3;
  payload.writeInt16LE(465, 9);
  payload.writeUInt32LE(12, 14);
  payload.writeUInt32LE(8_123, 18);
  payload.writeUInt32LE(20, 22);
  payload.writeUInt32LE(321, 26);
  payload[38] = 1;
  payload.writeUInt32LE(0xffffffff, 41);
  payload.writeUInt32LE(224, 45);
  payload.writeInt16LE(-510, 112);
  payload.writeInt16LE(468, 116);
  assert.deepEqual(decodeState(payload), {
    socPct: 0, remainingEnergyWh: 4650, batteryPowerW: -510, gridPowerW: 468,
    acOutputPowerW: 468, backupLoadPowerW: 0, inverterState: 3, workMode: 1,
    dailyEnergyInWh: 120, dailyEnergyOutWh: 200, monthlyEnergyInWh: 8123,
    monthlyEnergyOutWh: 3210, totalEnergyInWh: 42_949_672_950, totalEnergyOutWh: 2240,
  });
  payload[11] = 255;
  payload.writeInt16LE(-1, 9);
  assert.equal(decodeState(payload).socPct, null);
  assert.equal(decodeState(payload).remainingEnergyWh, null);
  assert.throws(() => decodeState(payload.subarray(0, 133)), /payload length/);
});

test("reads the UPS flag from the tenth work-mode slot", async () => {
  const slots = Buffer.alloc(80);
  slots[7] = 1; // A regular manual slot can be enabled independently of UPS.
  assert.equal(decodeUpsEnabled(slots), false);
  slots[79] = 1;
  assert.equal(decodeUpsEnabled(slots.subarray(0, 79)), null);
  const frame = responseFrame(GET_WORK_MODE_SETTINGS, slots, true);
  let notify: ((bytes: Buffer) => void) | undefined;
  const connection = {
    signal: new AbortController().signal,
    onBytes(listener: (bytes: Buffer) => void) {
      notify = listener;
      return () => { notify = undefined; };
    },
    async write(bytes: Buffer) {
      assert.equal(bytes.toString("hex"), "7306230a015d");
      notify?.(frame.subarray(0, 20));
      notify?.(frame.subarray(20));
    },
  };
  assert.equal(decodeUpsEnabled(await requestFrame(connection, GET_WORK_MODE_SETTINGS, connection.signal)), true);
  slots[79] = 255;
  assert.equal(decodeUpsEnabled(slots), null);
});

test("matches the requested command and unsubscribes after an interrupted request", async () => {
  const disconnected = new AbortController();
  let notify: ((bytes: Buffer) => void) | undefined;
  const connection = {
    signal: disconnected.signal,
    onBytes(listener: (bytes: Buffer) => void) {
      notify = listener;
      return () => { notify = undefined; };
    },
    async write(bytes: Buffer) {
      assert.equal(bytes.toString("hex"), "7305230356");
      notify?.(responseFrame(DEVICE_INFO, Buffer.alloc(0)));
    },
  };
  const pending = requestFrame(connection, STATE, new AbortController().signal);
  const payload = Buffer.alloc(139);
  const frame = responseFrame(STATE, payload);
  notify?.(frame.subarray(0, 14));
  notify?.(frame.subarray(14));
  assert.deepEqual(await pending, payload);
  assert.equal(notify, undefined);
  assert.equal(readCommand(DEVICE_INFO).toString("hex"), "7305230451");

  const interrupted = requestFrame(connection, STATE, new AbortController().signal);
  disconnected.abort(new Error("BLE disconnected"));
  await assert.rejects(interrupted, /BLE disconnected/);
  assert.equal(notify, undefined);
});
