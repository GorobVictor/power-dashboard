# Power Dashboard

Збір телеметрії Marstek Venus E 3.0 (`VNSE3-0`, EMS 150) через Bluetooth Low Energy. Node.js воркер використовує `dbus-next` і BlueZ на Ubuntu. PostgreSQL зберігає історію для кожної станції. Next.js надає останній вимір через HTTP API.

## Запуск на Ubuntu Server

1. Перевір, що служба Bluetooth активна, потрібний адаптер увімкнений і Ubuntu бачить MAC станції під час сканування.

   ```sh
   systemctl is-active bluetooth
   bluetoothctl list
   bluetoothctl --timeout 15 scan on
   bluetoothctl devices
   test -S /run/dbus/system_bus_socket
   ```

2. Скопіюй `.env.example` у `.env` і заповни його. Для Compose потрібні `POSTGRES_PASSWORD`, `API_USERNAME` і `API_PASSWORD`. Логін Basic Auth має бути без двокрапки. Задай усі п’ять полів станції, щоб увімкнути її збір.

   | Змінна | Значення |
   | --- | --- |
   | `STATION_ID` | Внутрішній текстовий ID для URL, наприклад `marstek-home` |
   | `STATION_NAME` | Назва станції, наприклад `Marstek Home` |
   | `STATION_MODEL` | `VNSE3-0` |
   | `STATION_DEVICE_ID` | Device ID з Marstek, з усіма цифрами |
   | `STATION_BLE_MAC` | BLE-адреса у форматі `02:00:00:00:00:01` |
   | `BLE_ADAPTER` | Адаптер BlueZ, типово `hci0` |
   | `POLL_INTERVAL_MS` | Інтервал опитування, типово `1000` |
   | `STALE_AFTER_MS` | Вік застарілого виміру, типово `5000` |
   | `API_PORT` | Порт API на `127.0.0.1`, типово `3000` |

   Локальні процеси `npm run bootstrap`, `npm run worker` і API приймають змінні PostgreSQL `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`. Для воркера поза Compose типовий шлях системної шини визначає `dbus-next`. Його можна задати через `DBUS_SYSTEM_BUS_ADDRESS`.

3. Запусти застосунок. Сервіс `bootstrap` застосовує міграції та реєструє станцію перед запуском API й воркера. Повторний запуск зберігає всі виміри. Воркер читає список активних станцій під час старту, тому після додавання станції або зміни цього списку його треба перезапустити.

   ```sh
   docker compose up -d --build
   docker compose logs -f worker
   ```

   Для запуску на Mac або перевірки без BLE виконай `docker compose up -d --build api` і відкрий `http://127.0.0.1:3000`. Системний сокет BlueZ монтується лише у воркер. У разі відмови D-Bus перевір доступ користувача контейнера до шини й політику BlueZ хоста. Після заміни системного сокета D-Bus на хості перествори контейнер воркера.

## Homarr

У Homarr створи Custom API widget з HTTP source. Вкажи URL, доступний серверу Homarr, вибери **Basic** для Authentication і збережи логін та пароль з `.env`. За замовчуванням API опубліковано лише на `127.0.0.1` хоста. Локально запит можна перевірити через `curl`, який запитає пароль інтерактивно.

```sh
curl --user homarr 'http://127.0.0.1:3000/api/v1/stations/marstek-home/latest'
```

[Документація Homarr](https://homarr.dev/docs/management/custom-widgets/)

## Контракт API

`GET /api/v1/stations/{stationId}/latest` повертає JSON з `Cache-Control: no-store`.

```json
{
  "station": { "id": "marstek-home", "name": "Marstek Home", "model": "VNSE3-0" },
  "measurement": {
    "measuredAt": "2026-01-01T00:00:00.000Z",
    "socPct": 72,
    "remainingEnergyWh": 3660,
    "batteryPowerW": -510,
    "gridPowerW": 468,
    "acOutputPowerW": 468,
    "backupLoadPowerW": 0,
    "inverterState": 3,
    "workMode": 1,
    "dailyEnergyInWh": 120,
    "dailyEnergyOutWh": 200,
    "monthlyEnergyInWh": 8123,
    "monthlyEnergyOutWh": 3210,
    "totalEnergyInWh": 650000,
    "totalEnergyOutWh": 440000
  },
  "stale": false
}
```

- `200` повертає останній успішний вимір. `measuredAt` — час отримання відповіді станції у UTC (ISO 8601). `stale` стає `true`, коли вік виміру досягає `STALE_AFTER_MS`. Для відомої станції без вимірів `measurement` і `stale` дорівнюють `null`.
- `401` означає відсутні або неправильні облікові дані. `404` означає невідомий ID. `503` означає, що API не може обробити запит через конфігурацію або недоступність PostgreSQL.
- `socPct` вимірюється у відсотках. `batteryPowerW` додатна під час заряду й від’ємна під час розряду. Для `acOutputPowerW` і `gridPowerW` додатне значення означає віддачу з відповідного виходу станції, від’ємне — споживання через нього. `backupLoadPowerW` показує навантаження резервного виходу.
- `remainingEnergyWh` та енергетичні лічильники нормалізуються у Wh. `In` означає енергію заряду, `Out` — енергію розряду. Для залишку та лічильників EMS 150 використовується масштаб 10 Wh на крок, для `monthlyEnergyInWh` — 1 Wh на крок. Недоступний показник має значення `null`. Дійсний нуль зберігається.
- `inverterState` і `workMode` — коди станції. Для інвертора відомі коди `0` сон, `1` очікування, `2` заряд, `3` розряд, `4` резерв, `5` оновлення, `6` байпас. Для режиму роботи `0` — самоспоживання, `1` — ручний режим.

Воркер зберігає один рядок на кожну успішну відповідь. За інтервалу 1 с це до 86 400 рядків на станцію за добу. Історія зберігається в PostgreSQL без автоматичного видалення.

## Перевірка

Для локальних npm-команд потрібен Node.js 24.

```sh
npm ci
npm run lint
npm test
npm run build
```

`npm test` запускає тести декодера, обміну й Basic Auth. Для тесту міграцій, блокувань та ізоляції вимірів двох станцій задай `TEST_DATABASE_URL` до тестового PostgreSQL. Тест створює тимчасову схему.

На Ubuntu звір заряд, напрямок потужності й енергетичні лічильники з показниками Marstek. За стабільного з’єднання перевір оновлення часу приблизно щосекунди. Після втрати BLE-зв’язку API має зберегти попереднє значення й позначити його застарілим, а після відновлення показати новий вимір.

Джерела протоколу: [GATT-транспорт](https://github.com/sphings79/marstek-ble-control/blob/master/src/lib/transport/WebBluetoothTransport.ts), [формат STATE](https://github.com/sphings79/marstek-ble-control/blob/master/src/lib/payloads/StatePayload.ts), [аналіз EMS 150](https://github.com/sphings79/Marstek-Venus-Firmware-Reverse-Engineering/blob/main/Control_FW/VNSE3_Control_FW_v150_Full_Analysis.md).
