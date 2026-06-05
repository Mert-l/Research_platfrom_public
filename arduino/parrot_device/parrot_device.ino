/*
 * Parrot Project — FULL PARROT DEVICE  (Arduino Nano ESP32 / ESP32-S3)
 *
 * ================================= FUNCTIONS ==================================
 *  - Button presses play a mapped sound (config/button_map.json on the SD card).
 *  - Presses are logged to /queue.csv (button, file, ISO timestamp, ms-gap).
 *  - A "WiFi/sync mode" connects WiFi (captive portal via WiFiManager), syncs the
 *    clock over NTP, downloads new config + sounds from the server, and uploads
 *    the press log. Audio is suppressed while in sync mode.
 *
 * =================================== INPUTS ===================================
 * INPUT IS SIMULATED OVER THE SERIAL MONITOR (no physical switches yet):
 *  0-9 = press that button 
 *  w   = toggle WiFi/sync mode
 *  s   = stop
 *  l   = list/menu
 *  t   = I2S test tone
 *  +/- = volume
 *
 * =================================== PINOUT ===================================
 *  SD card module (SPI):              
 *    CS   -> D10
 *    SCK  -> D13
 *    MOSI -> D11  (auto-detects D12)
 *    MISO -> D12  (auto-detects D11)
 *    VCC  -> 5V
 *    GND  -> GND
 *  
 *  MAX98357A (I2S):
 *    DIN  -> D9   (GPIO18)
 *    BCLK -> D8   (GPIO17)
 *    LRC  -> D7   (GPIO10)
 *    VIN  -> 5V
 *    GND  -> GND
 *    GAIN/SD floating
 *
 * =================================== SERVER ===================================
 * Server: *BASE_URL = "https://2026-26-puppetsforparrots-production.up.railway.app". Endpoints used:
 *   GET  /api/config/button_map.json     -> /config/button_map.json
 *   GET  /api/sounds                     -> JSON list of {"name": "..."}
 *   GET  /api/sounds/<file>              -> /sounds/<file>
 *   POST /api/log    {button, soundfile, timestamp, ms_since_last_sound}
 */

#include <Arduino.h>
#include <SPI.h>
#include <SD.h>
#include <FS.h>
#include <WiFi.h>
#include <WiFiManager.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>

#include <AudioFileSourceSD.h>
#include <AudioGeneratorMP3.h>
#include <AudioGeneratorWAV.h>
#include <AudioOutputI2S.h>

// ================================= DEFINITIONS ================================
// Server
static const char *BASE_URL = "https://2026-26-puppetsforparrots-production.up.railway.app";

// SD
#define SD_CS   D10
#define SD_SCK  D13
struct PinOrder { int mosi; int miso; const char *label; };
static const PinOrder PIN_ORDERS[] = {
  { D11, D12, "MOSI=D11 MISO=D12" },
  { D12, D11, "MOSI=D12 MISO=D11" },
};
static const int      NUM_ORDERS = sizeof(PIN_ORDERS) / sizeof(PIN_ORDERS[0]);
static const uint32_t SD_FREQ    = 20000000;    // 20 MHz

// I2S (MAX98357A)
#define I2S_DOUT  18   // D9
#define I2S_BCLK  17   // D8
#define I2S_LRC   10   // D7

// WiFi / Sync mode switch
#define WIFI_SWITCH_PIN  D2
static bool wifiSwitchHigh() { return digitalRead(WIFI_SWITCH_PIN) == HIGH; }
WiFiClientSecure secureClient;

// Scanned files
//  (fallback when a button isn't in button_map.json)
static const int MAX_FILES = 64;
String files[MAX_FILES];
int    fileCount = 0;

// Audio objects
//  (recreated per track)
AudioFileSourceSD *src = nullptr;
AudioGeneratorMP3 *mp3 = nullptr;
AudioGeneratorWAV *wav = nullptr;
AudioOutputI2S    *out = nullptr;
bool  playing = false;
float gain    = 0.5f;

// WiFi / Sync state
WiFiManager wm;
bool wifiMode = false;
unsigned long lastSyncMs = 0;
const unsigned long SYNC_INTERVAL_MS = 10000;

// Press logging
const char *QUEUE_FILE = "/queue.csv";
unsigned long lastSoundMs = 0;
struct PressLog { int button; String soundFile; String timestamp; unsigned long gap; };
static const int MAX_QUEUE = 200;
PressLog logQueue[MAX_QUEUE];
int queueCount = 0;

// switch definitions 
const int switchPins[] = {D3, D4, D5, D6};
const int numSwitches = 4;

int lastStates[numSwitches];
int baselineStates[numSwitches];


// ================================= SD / AUDIO =================================
static bool mountSD() {
  for (int i = 0; i < NUM_ORDERS; i++) {
    Serial.printf("Mounting SD (%s) ... ", PIN_ORDERS[i].label);
    SD.end(); SPI.end();
    SPI.begin(SD_SCK, PIN_ORDERS[i].miso, PIN_ORDERS[i].mosi, SD_CS);
    if (SD.begin(SD_CS, SPI, SD_FREQ) && SD.cardType() != CARD_NONE) {
      Serial.println(F("OK"));
      return true;
    }
    Serial.println(F("no"));
  }
  return false;
}

static bool isAudio(const String &p) {
  String low = p; low.toLowerCase();
  return low.endsWith(".mp3") || low.endsWith(".wav");
}

static void scan(File dir) {
  File e = dir.openNextFile();
  while (e && fileCount < MAX_FILES) {
    if (e.isDirectory()) {
      if (String(e.name()) != "System Volume Information") scan(e);
    } else if (e.size() > 0 && isAudio(e.path())) {
      files[fileCount++] = String(e.path());
    }
    e = dir.openNextFile();
  }
}

static void stopPlay() {
  if (mp3) { mp3->stop(); delete mp3; mp3 = nullptr; }
  if (wav) { wav->stop(); delete wav; wav = nullptr; }
  if (src) { delete src; src = nullptr; }
  if (out) { delete out; out = nullptr; }
  playing = false;
}

// Play any file by full SD path. Returns true if playback started.
static bool startPlayPath(const String &path) {
  stopPlay();
  if (!SD.exists(path)) { Serial.printf("  missing %s\n", path.c_str()); return false; }
  Serial.printf("Playing %s\n", path.c_str());

  out = new AudioOutputI2S();
  out->SetPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
  out->SetGain(gain);
  src = new AudioFileSourceSD(path.c_str());

  String low = path; low.toLowerCase();
  bool ok = false;
  if (low.endsWith(".mp3")) {
    mp3 = new AudioGeneratorMP3();
    ok = mp3->begin(src, out);
    if (!ok) { delete mp3; mp3 = nullptr; }
  } else {
    wav = new AudioGeneratorWAV();
    ok = wav->begin(src, out);
    if (!ok) { delete wav; wav = nullptr; }
  }
  if (!ok) {
    Serial.println(F("  begin failed (bad/corrupt file?)"));
    if (src) { delete src; src = nullptr; }
    if (out) { delete out; out = nullptr; }
    stopPlay(); 
    return false;
  }
  playing = true;
  return true;
}

static void pumpAudio() {
  if (!playing) return;
  bool running = false;
  if (mp3) running = mp3->isRunning() && mp3->loop();
  else if (wav) running = wav->isRunning() && wav->loop();
  if (!running) { Serial.println(F("  finished.")); stopPlay(); 
    captureCurrentSwitchStates(); 
    Serial.println(F("updates switch states."));}

}

static void testTone() {
  Serial.println(F("Test tone: 440 Hz for 1.5 s ..."));
  AudioOutputI2S *o = new AudioOutputI2S();
  o->SetPinout(I2S_BCLK, I2S_LRC, I2S_DOUT);
  o->SetRate(22050); o->SetChannels(2); o->SetGain(0.8f); o->begin();
  const int cycle = 22050 / 440, half = cycle / 2;
  long total = 22050L * 3 / 2;
  for (long i = 0; i < total; ) {
    int16_t v = ((i % cycle) < half) ? 12000 : -12000;
    int16_t s[2] = { v, v };
    if (o->ConsumeSample(s)) i++; else yield();
  }
  o->stop(); delete o;
  Serial.println(F("Test tone done."));
}

// to avoid triggering sounds when a sound is currently already playing
// this updates the switch states, gets called in PumpAudio.
static void captureCurrentSwitchStates() {
  for (int i = 0; i < numSwitches; i++) {
    lastStates[i] = digitalRead(switchPins[i]);
    baselineStates[i] = lastStates[i];
  }
  Serial.print(F("current states: "));
  for (int i = 0; i < numSwitches; i++) {
    Serial.print(baselineStates[i]);
    Serial.print(" ");
  }
  Serial.println();
}


// runs in loop, plays sound when switched state is detected.
static void checkSwitches() {

  if (wifiMode) return;
  if (playing) return;

  for (int i = 0; i < numSwitches; i++) {
    int state = digitalRead(switchPins[i]);
    if (state != baselineStates[i]) {
      baselineStates[i] = state; 
      
      Serial.printf(
        "Switch %d changed -> trigger button %d\n",
        i,
        i + 1
      );
      for (int i = 0; i < numSwitches; i++) {
        Serial.printf(
          "i=%d pin=%d state=%d baseline=%d\n",
          i,
          switchPins[i],
          digitalRead(switchPins[i]),
          baselineStates[i]
        );
      }
      pressButton(i + 1);
      return;
    }
  }
}
// ================================ TIME / WIFI =================================
static String getTimestamp() {
  time_t now = time(nullptr);
  struct tm t;
  gmtime_r(&now, &t);
  char buf[30];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);   // ISO-8601 UTC
  return String(buf);
}

static void syncClock() {
  Serial.println(F("Syncing time via NTP..."));
  configTime(0, 0, "pool.ntp.org");
  time_t nowTime = time(nullptr);
  int retry = 0;
  while (nowTime < 100000 && retry < 15) { delay(500); nowTime = time(nullptr); retry++; }
  Serial.print(F("Synced time: ")); Serial.println(getTimestamp());
}

static void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  Serial.println(F("\n========== WIFI START =========="));
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  wm.setConfigPortalTimeout(0);                  // portal never times out
  bool connected = wm.autoConnect("Parrot-device-Setup");
  if (!connected) {
    Serial.println(F("Failed; starting config portal..."));
    WiFi.disconnect(true); delay(1000);
    if (!wm.startConfigPortal("Parrot-device-Setup")) {
      Serial.println(F("Portal failed; restarting.")); delay(3000); ESP.restart();
    }
  }
  Serial.print(F("WiFi connected! IP: ")); Serial.println(WiFi.localIP());
  // https mode
  secureClient.setInsecure();
  syncClock();
}

// ================================= SERVER CONNECTION ================================

static String apiUrl(const String &path) {
  return String(BASE_URL) + path;
}

static void ensureDirectories() {
  if (!SD.exists("/config")) SD.mkdir("/config");
  if (!SD.exists("/sounds")) SD.mkdir("/sounds");
}

static bool downloadFile(const String &url, const String &localPath) {
  HTTPClient http;
  http.begin(secureClient, url);
  http.addHeader("Connection", "close");
  int code = http.GET();
  if (code != HTTP_CODE_OK) { Serial.printf("Download failed: %d\n", code); http.end(); return false; }

  int total = http.getSize();
  WiFiClient *stream = http.getStreamPtr();
  File f = SD.open(localPath, FILE_WRITE);
  if (!f) { http.end(); return false; }

  int got = 0; uint8_t buf[512];
  while (http.connected() || stream->available()) {
    size_t avail = stream->available();
    if (avail) { int c = stream->readBytes(buf, min(avail, sizeof(buf))); f.write(buf, c); got += c; }
  }
  f.close(); http.end();
  return got > 0;
}

// Config files use a safe .tmp-then-rename swap, sounds download directly.
static bool replaceFileFromServer(const String &remoteUrl, const String &localPath) {
  if (localPath.startsWith("/config/")) {
    String tmp = localPath + ".tmp";
    if (SD.exists(tmp)) SD.remove(tmp);
    if (!downloadFile(remoteUrl, tmp)) return false;
    if (SD.exists(localPath)) SD.remove(localPath);
    if (!SD.rename(tmp, localPath)) { Serial.println(F("Config rename failed")); return false; }
    return true;
  }
  if (SD.exists(localPath)) SD.remove(localPath);
  return downloadFile(remoteUrl, localPath);
}

static void syncConfig() {
  if (replaceFileFromServer(apiUrl("/api/config/button_map.json"), "/config/button_map.json"))
    Serial.println(F("Config synced"));
  else
    Serial.println(F("Config sync failed - keeping old"));
}

static void syncSounds() {
  HTTPClient http;
  http.begin(secureClient, apiUrl("/api/sounds"));
  if (http.GET() != HTTP_CODE_OK) { Serial.println(F("Sound index fetch failed")); http.end(); return; }
  String payload = http.getString();
  http.end();

  int pos = 0;
  while (true) {
    int nameKey = payload.indexOf("\"name\"", pos);
    if (nameKey == -1) break;
    int q1 = payload.indexOf("\"", nameKey + 7);
    int q2 = payload.indexOf("\"", q1 + 1);
    String fileName = payload.substring(q1 + 1, q2);
    String localPath = "/sounds/" + fileName;
    if (!SD.exists(localPath)) {
      Serial.print(F("Downloading: ")); Serial.println(fileName);
      replaceFileFromServer(apiUrl("/api/sounds/" + fileName), localPath);
    }
    pos = q2;
  }
  Serial.println(F("Sound sync complete"));
}

static void syncServerFiles() {
  if (WiFi.status() != WL_CONNECTED) connectWiFi();
  ensureDirectories();
  syncConfig();
  syncSounds();
  // refresh our in-memory playlist after a sync
  fileCount = 0;
  scan(SD.open("/"));
}

// =========================== BUTTON TO SOUND MAPPING ==========================
static String getMappedFile(int buttonNumber) {
  File f = SD.open("/config/button_map.json");
  if (!f) return "";
  String json = f.readString();
  f.close();
  String key = "\"" + String(buttonNumber) + "\":";
  int pos = json.indexOf(key);
  if (pos == -1) return "";
  int start = json.indexOf("\"", pos + key.length());
  int end   = json.indexOf("\"", start + 1);
  if (start == -1 || end == -1) return "";
  return json.substring(start + 1, end);
}

static void queuePressLog(int buttonNumber, const String &fileName) {
  if (queueCount >= MAX_QUEUE) return;
  unsigned long nowMs = millis();
  unsigned long delta = (lastSoundMs == 0) ? 0 : nowMs - lastSoundMs;
  lastSoundMs = nowMs;
  String ts = getTimestamp();

  File f = SD.open(QUEUE_FILE, FILE_APPEND);
  if (f) {
    f.print(buttonNumber); f.print(",");
    f.print(fileName);     f.print(",");
    f.print(ts);           f.print(",");
    f.println(delta);
    f.close();
  }
  logQueue[queueCount++] = { buttonNumber, fileName, ts, delta };
}

static void flushQueue() {
  if (queueCount == 0) return;
  Serial.printf("Uploading %d log entries...\n", queueCount);
  for (int i = 0; i < queueCount; i++) {
    if (WiFi.status() != WL_CONNECTED) break;
    HTTPClient http;
    http.setReuse(false);
    http.setTimeout(50000);
    http.begin(secureClient, apiUrl("/api/log"));
    http.addHeader("Content-Type", "application/json");
    String body = String("{\"button\":") + logQueue[i].button +
                  ",\"soundfile\":\"" + logQueue[i].soundFile +
                  "\",\"timestamp\":\"" + logQueue[i].timestamp +
                  "\",\"ms_since_last_sound\":" + logQueue[i].gap + "}";
    int httpCode = http.POST(body);
    Serial.printf("Posted: %s\n", body.c_str());

    Serial.printf("  POST %d\n", httpCode);
    http.end();
    delay(200);
  }
  queueCount = 0;
  if (SD.exists(QUEUE_FILE)) SD.remove(QUEUE_FILE);
}

// =========================== ENTER / EXIT WIFI MODE ===========================
static void enterWifiMode() {
  Serial.println(F("\n--- WiFi/SYNC mode ON (audio suppressed) ---"));
  stopPlay();
  connectWiFi();
  flushQueue();
  syncServerFiles();
  lastSyncMs = millis();
}

static void exitWifiMode() {
  Serial.println(F("--- WiFi/SYNC mode OFF (play mode) ---"));
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
}

// Switch into/out of sync mode, running the proper entry/exit work once.
static void setWifiMode(bool on) {
  if (on == wifiMode) return;
  wifiMode = on;
  if (wifiMode) enterWifiMode(); else exitWifiMode();
}

// ============================== INPUT / BUTTONS ===============================
// Resolve a bare filename to a full path: prefer /sounds/<name>, otherwise find
// it anywhere in the scanned list (e.g. /sounds/backup/<name>). "" if not found.
static String resolveSound(const String &fileName) {
  String direct = "/sounds/" + fileName;
  if (SD.exists(direct)) return direct;
  for (int i = 0; i < fileCount; i++) {
    if (files[i].endsWith("/" + fileName) || files[i] == fileName) return files[i];
  }
  return "";
}

// A button press: look up its mapped sound, log it, and play it.
static void pressButton(int buttonNumber) {
  if (wifiMode) { Serial.println(F("(in sync mode - press 'w' to return to play mode)")); return; }

  String fileName = getMappedFile(buttonNumber);
  String path;
  if (fileName.length()) {
    path = resolveSound(fileName);                 // mapped sound (search subfolders)
    if (!path.length()) { Serial.printf("Button %d -> %s (not found on card)\n", buttonNumber, fileName.c_str()); return; }
  } else if (buttonNumber < fileCount) {
    path = files[buttonNumber];                    // fallback: scanned file by index
    fileName = path.substring(path.lastIndexOf('/') + 1);
    Serial.printf("(button %d not in map; fallback to %s)\n", buttonNumber, fileName.c_str());
  } else {
    Serial.printf("Button %d: no mapping and no file #%d\n", buttonNumber, buttonNumber);
    return;
  }

  Serial.printf("Button %d -> %s\n", buttonNumber, fileName.c_str());

  bool ok = startPlayPath(path);

  if (!ok) {
    Serial.printf("ERROR: failed to play %s \n", path.c_str());
    return; 
  }
  // only log if playback actually started
  queuePressLog(buttonNumber, fileName);
}

static void handleKey(int c) {
  if (c >= '0' && c <= '9') { pressButton(c - '0'); return; }
  switch (c) {
    case 'w': case 'W': setWifiMode(!wifiMode); break;
    case 's': case 'S': stopPlay(); Serial.println(F("Stopped.")); break;
    case 'l': case 'L': printMenu(); break;
    case 't': case 'T': stopPlay(); testTone(); break;
    case '+': gain = min(1.0f, gain + 0.1f); if (out) out->SetGain(gain); Serial.printf("Volume %.1f\n", gain); break;
    case '-': gain = max(0.0f, gain - 0.1f); if (out) out->SetGain(gain); Serial.printf("Volume %.1f\n", gain); break;
    default: break;
  }
}

// ================================= PRINT MENU =================================
static void printMenu() {
  Serial.println(F("\n===== Parrot device ====="));
  Serial.println(F("  Audio files buttons are mapped to in button_map.json:"));
  for (int i = 0; i <= 9; i++) { 
    String mapped = getMappedFile(i);
    if (mapped.length())
      Serial.printf("  [%d] -> %s (mapped)\n", i, mapped.c_str());
    else if (i < fileCount)
      Serial.printf("  [%d] -> %s (fallback)\n", i, files[i].c_str());
    else
      Serial.printf("  [%d] -> (nothing)\n", i);
  }
  //Serial.printf("  %d audio file(s) on SD.\n", fileCount);
  //for (int i = 0; i < fileCount; i++) Serial.printf("  [%d] %s\n", i, files[i].c_str());
  Serial.println(F("  keys: 0-9 press | w wifi/sync | s stop | l list | t tone | +/- volume"));
  // this is changed depending on switch type. may not be correct as printed. 
  Serial.println(F("  (or short D2 -> 3.3V to enter WiFi/sync mode)"));
  Serial.printf("  WiFi/sync mode: %s\n", wifiMode ? "ON" : "OFF");
  Serial.println(F("========================="));
}

// ==================================== MAIN ====================================
void setup() {
  Serial.begin(115200);
  delay(1500);
  Serial.println(F("\nParrot Project - full device (Nano ESP32)"));

  // switch initialization
  for (int i = 0; i < numSwitches; i++) {
  pinMode(switchPins[i], INPUT_PULLUP);

  lastStates[i] = digitalRead(switchPins[i]);
  baselineStates[i] = lastStates[i];
  }
  

  // wifi switch initialization
  // !!!! this should change for different switch!! currently set for simple switch not the led one. INPUT_PULLUP => INPUT_PULLDOWN waarschijnlijk
  pinMode(WIFI_SWITCH_PIN, INPUT_PULLUP);   // active-high: 3.3V on D2 = sync mode 


  // sd initialization
  if (!mountSD()) {
    Serial.println(F("SD mount FAILED - check 5V power + wiring."));
    return;
  }
  ensureDirectories();
  scan(SD.open("/"));
  printMenu();
  secureClient.setInsecure();
  Serial.println(F("Ready. Press 0-9 to trigger a sound."));
}
void loop() {
  while (Serial.available()) handleKey(Serial.read());

  // check switches that play sound
  checkSwitches();

  // ===================== WIFI SWITCH (D2 → GND, ACTIVE LOW) =====================
  static int lastState = HIGH;
  static unsigned long lastChangeMs = 0;
  const unsigned long debounceMs = 80;

  int state = digitalRead(WIFI_SWITCH_PIN);

  if (state != lastState && (millis() - lastChangeMs) > debounceMs) {
    lastChangeMs = millis();
    lastState = state;

    if (state == LOW) {
      Serial.println(F("D2 LOW → entering WiFi mode"));
      setWifiMode(true);
    } else {
      Serial.println(F("D2 HIGH → exiting WiFi mode"));
      setWifiMode(false);
    }
  }

  // ===================== MODE HANDLING =====================
  if (wifiMode) {
    // WiFi/SYNC MODE (no audio)

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println(F("Reconnecting WiFi"));
      connectWiFi();
    }

    if (millis() - lastSyncMs > SYNC_INTERVAL_MS) {
      syncServerFiles();
      flushQueue();
      lastSyncMs = millis();
    }

  } else {
    // PLAY MODE
    pumpAudio();
  }

  delay(1);
}