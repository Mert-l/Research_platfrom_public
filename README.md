# Parrot Device Dashboard

React dashboard + local API for the Arduino Nano ESP32 parrot music-preference research device.

The system has 3 parts:

1. Web app: assign sounds to buttons and view research analytics.
2. Local API: stores button mappings, sound files, and button-press logs in `mock_device/`.
3. Arduino Nano ESP32: reads 4 physical buttons, plays audio, and posts press logs to the API.

The app can be accessed here: [Open the app](https://parrots-public.vercel.app/)

---

## Requirements

- Node.js v20 or higher
- npm
- Arduino IDE
- Arduino libraries:
  - `DFRobotDFPlayerMini`

---

## Install

```bash
npm install
```

---

## Run the local API

Open terminal 1:

```bash
npm run dev:api
```

This starts:

```text
http://localhost:3001
```

---

## Run the web app

Open terminal 2:

```bash
npm run dev
```

Then open:

```text
http://localhost:8080
```

---

## How the data works

Button assignments are saved here:

```text
mock_device/config/button_map.json
```

Button press logs are saved here:

```text
mock_device/log/database.csv
```

Sound files are stored here:

```text
mock_device/sounds/
```

---

## API endpoints

```text
GET  /api/config
POST /api/config
GET  /api/sounds
POST /api/sounds
GET  /api/logs
POST /api/log
```

Arduino sends button presses to:

```text
POST http://YOUR_LAPTOP_IP:3001/api/log
```

Example JSON:

```json
{
  "button": 1,
  "soundfile": "sound1.wav"
}
```

---

## Arduino setup

The Arduino sketch is here:

```text
arduino/parrot_device/parrot_device.ino
```

Important: the Arduino cannot use `localhost`. In the sketch, change:

```cpp
const char* API_HOST = "192.168.1.23";
```

to your laptop's local WiFi IP address.

On Windows, you can find it with:

```bash
ipconfig
```

Look for your WiFi IPv4 address.

---

## Audio playback hardware note

The sketch assumes a DFPlayer Mini audio module with a microSD card.
Put audio files on the DFPlayer microSD card as:

```text
/mp3/0001.mp3
/mp3/0002.mp3
/mp3/0003.mp3
/mp3/0004.mp3
```

Button 1 plays track 1, button 2 plays track 2, etc.

The web app stores the research mapping and logs. The physical audio playback happens on the DFPlayer module.
