# 🦜 Parrot Audio Device System

## Overview
System connecting a React frontend, Node.js API, and ESP32 audio device with SD storage and WiFi sync.

---

## Frontend
https://parrots-public.vercel.app/

- Assign sounds to buttons
- Upload and manage audio
- Sends API requests to backend

---

## Backend (Node.js API)

Manages config, sounds, and logs.

### Endpoints
- `GET /api/config`
- `POST /api/config`
- `GET /api/sounds`
- `POST /api/sounds`
- `GET /api/device-config`
- `GET /api/logs`
- `POST /api/log`

---

## Device (ESP32 Parrot Player)

- Plays MP3/WAV from SD card
- Uses `/config/button_map.json`
- Logs presses to `/queue.csv`
- Syncs config + sounds over WiFi
- Uploads logs to server
- Offline playback supported

### Hardware
- SD card (audio + config)
- MAX98357A I2S audio
- ESP32 WiFi + NTP sync
- Button/switch inputs

---

## Architecture
```text
React (Vercel)
   ↓ HTTP
Node.js API
   ↓ HTTPS sync
ESP32 Device
 ├─ SD card (sounds/config)
 ├─ Audio output (I2S)
 ├─ WiFi sync mode

```
## Repository Map 
```text

├── arduino/
│   └── parrot_device/
│       └── (ESP32 Arduino firmware code)

├── mock_device/
│   └── (local simulation of device storage + logs + sounds)

├── server/
│   └── (Node.js backend API: config, sounds, logs, sync)

├── src/
│   └── (React frontend source code) 
```