const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MOCK = path.join(ROOT, 'mock_device');

const CONFIG_PATH = path.join(MOCK, 'config', 'button_map.json');
const USER_CONFIGS_DIR = path.join(MOCK, 'config', 'users');

const SOUND_INDEX_PATH = path.join(MOCK, 'metadata', 'sound_index');
const LOG_PATH = path.join(MOCK, 'log', 'database.csv');
const SOUNDS_DIR = path.join(MOCK, 'sounds');

function ensureFiles() {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.mkdirSync(USER_CONFIGS_DIR, { recursive: true });
  fs.mkdirSync(path.dirname(SOUND_INDEX_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });

  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ 1: '', 2: '', 3: '', 4: '' }, null, 2));
  }

  if (!fs.existsSync(SOUND_INDEX_PATH)) {
    fs.writeFileSync(SOUND_INDEX_PATH, JSON.stringify({ sounds: [] }, null, 2));
  }

  if (!fs.existsSync(LOG_PATH)) {
    fs.writeFileSync(
      LOG_PATH,
      'timestamp,owner_email,button,soundfile,ms_since_last_sound\n'
    );
  }
}

function send(res, status, data, type = 'application/json') {
  res.writeHead(status, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  if (type === 'application/json') {
    res.end(JSON.stringify(data));
  } else {
    res.end(data);
  }
}

function readJsonBody(req) {
  const t0 = Date.now();
  console.log("  └─ reading body start", t0);

  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', chunk => {
      body += chunk;
      console.log("  └─ chunk", chunk.length, "bytes");
    });

    req.on('end', () => {
      const t1 = Date.now();
      console.log("  └─ body END", t1, "duration:", t1 - t0, "ms");

      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function emptyConfig() {
  return { 1: '', 2: '', 3: '', 4: '' };
}

function cleanConfig(next = {}) {
  const clean = {};

  [1, 2, 3, 4].forEach(id => {
    clean[id] = String(next[id] || '');
  });

  return clean;
}

function cleanOwnerEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, '_');
}

function ownerEmailFromRequest(url, body = {}) {
  return cleanOwnerEmail(
    body.owner_email ||
    body.ownerEmail ||
    url.searchParams.get('owner_email') ||
    url.searchParams.get('ownerEmail') ||
    url.searchParams.get('email') ||
    ''
  );
}

function configPathForOwner(ownerEmail = '') {
  const cleanEmail = cleanOwnerEmail(ownerEmail);

  if (!cleanEmail) {
    return CONFIG_PATH;
  }

  return path.join(USER_CONFIGS_DIR, `${cleanEmail}.json`);
}

function readConfig(ownerEmail = '') {
  const configPath = configPathForOwner(ownerEmail);

  if (!fs.existsSync(configPath)) {
    return emptyConfig();
  }

  try {
    return cleanConfig(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {
    return emptyConfig();
  }
}

function writeConfig(config, ownerEmail = '') {
  const configPath = configPathForOwner(ownerEmail);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(cleanConfig(config), null, 2));
}

function readSoundIndex() {
  try {
    return JSON.parse(fs.readFileSync(SOUND_INDEX_PATH, 'utf8'));
  } catch {
    return { sounds: [] };
  }
}

function writeSoundIndex(index) {
  fs.writeFileSync(SOUND_INDEX_PATH, JSON.stringify(index, null, 2));
}

function listSounds(ownerEmail = '') {
  const cleanEmail = cleanOwnerEmail(ownerEmail);

  const index = readSoundIndex();
  const files = fs.readdirSync(SOUNDS_DIR).filter(f => /\.(wav|mp3)$/i.test(f));

  const fromIndex = new Map((index.sounds || []).map(s => [s.name, s]));

  const sounds = files.map(name => {
    return (
      fromIndex.get(name) || {
        name,
        label: name.replace(/\.[^.]+$/, ''),
        duration_ms: 0,
        owner_email: '',
      }
    );
  });

  if (!cleanEmail) {
    return sounds;
  }

  return sounds.filter(sound => cleanOwnerEmail(sound.owner_email) === cleanEmail);
}

function normalizeTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return Date.now();

  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber)) {
    return asNumber < 1000000000000 ? asNumber * 1000 : asNumber;
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function readLogs() {
  if (!fs.existsSync(LOG_PATH)) return [];

  const content = fs.readFileSync(LOG_PATH, 'utf8').trim();
  if (!content) return [];

  const lines = content.split(/\r?\n/);
  const header = lines[0] || '';
  const hasOwnerEmail = header.includes('owner_email');

  return lines.slice(1).filter(Boolean).map((line) => {
    const parts = line.split(',').map(v => v.trim());

    if (hasOwnerEmail) {
      const [timestamp, owner_email, button, soundfile, ms_since_last_sound] = parts;

      return {
        timestamp: normalizeTimestamp(timestamp),
        owner_email,
        button: Number(button),
        soundfile,
        ms_since_last_sound: Number(ms_since_last_sound || 0),
      };
    }

    const [timestamp, button, soundfile] = parts;

    return {
      timestamp: normalizeTimestamp(timestamp),
      owner_email: '',
      button: Number(button),
      soundfile,
      ms_since_last_sound: 0,
    };
  });
}

function appendLog({
  button,
  soundfile,
  timestamp,
  owner_email,
  ms_since_last_sound,
}) {
  const safeButton = Number(button);

  const safeOwnerEmail = String(owner_email || '')
    .replace(/[\r\n,]/g, '_');

  const safeSound = String(soundfile || '')
    .replace(/[\r\n,]/g, '_');

  const safeTimestamp = String(timestamp || '')
    .replace(/[\r\n,]/g, '_');

  const delta = Number(ms_since_last_sound || 0);

  fs.appendFileSync(
    LOG_PATH,
    `${safeTimestamp},${safeOwnerEmail},${safeButton},${safeSound},${delta}\n`
  );
}

function isAllowedSoundName(fileName) {
  return /\.(wav|mp3)$/i.test(fileName);
}

function isAllowedDuration(durationMs) {
  if (durationMs === undefined || durationMs === null || durationMs === '') return true;
  return Number(durationMs) <= 120000;
}

ensureFiles();

const server = http.createServer(async (req, res) => {
  const t0 = Date.now();
  const id = Math.random().toString(16).slice(2);

  console.log(`\n[${id}] ▶ INCOMING`, req.method, req.url, t0);

  try {
    if (req.method === 'OPTIONS') {
      return send(res, 204, {});
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, {
        ok: true,
        name: 'parrot-device-api',
        message: 'API is running. Use /api/health, /api/logs, /api/sounds, or /api/config.'
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, name: 'parrot-device-api' });
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      const ownerEmail = ownerEmailFromRequest(url);

      return send(res, 200, {
        owner_email: ownerEmail,
        buttons: readConfig(ownerEmail),
        sounds: listSounds(ownerEmail),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/config') {
      const body = await readJsonBody(req);
      const ownerEmail = ownerEmailFromRequest(url, body);
      const next = body.buttons || body;
      const clean = cleanConfig(next);

      writeConfig(clean, ownerEmail);

      return send(res, 200, {
        ok: true,
        owner_email: ownerEmail,
        buttons: clean,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/device-config') {
      const ownerEmail = ownerEmailFromRequest(url);
      const config = readConfig(ownerEmail);
      const sounds = listSounds(ownerEmail).map(s => s.name);
      const tracks = {};

      [1, 2, 3, 4].forEach(id => {
        const sound = config[id] || '';
        tracks[id] = Math.max(1, sounds.indexOf(sound) + 1);
      });

      return send(res, 200, {
        owner_email: ownerEmail,
        buttons: config,
        tracks,
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/config/button_map.json') {
      const raw = fs.readFileSync(CONFIG_PATH);

      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Length': raw.length,
        'Access-Control-Allow-Origin': '*',
      });

      return res.end(raw);
    }

    if (req.method === 'GET' && url.pathname === '/api/sounds') {
      const ownerEmail = ownerEmailFromRequest(url);

      return send(res, 200, {
        sounds: listSounds(ownerEmail),
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/sounds') {
      const body = await readJsonBody(req);
      const ownerEmail = ownerEmailFromRequest(url, body);

      if (!ownerEmail) {
        return send(res, 400, { error: 'Missing owner_email' });
      }

      const fileName = path
        .basename(String(body.name || 'sound.wav'))
        .replace(/[^a-zA-Z0-9._-]/g, '_');

      const base64 = String(body.data || '').replace(
        /^data:audio\/[a-zA-Z0-9.+-]+;base64,/,
        ''
      );

      if (!fileName || !base64) {
        return send(res, 400, { error: 'Missing name or data' });
      }

      if (!isAllowedSoundName(fileName)) {
        return send(res, 400, { error: 'Only MP3 and WAV files are allowed' });
      }

      if (!isAllowedDuration(body.duration_ms)) {
        return send(res, 400, { error: 'Sound files must be maximum 2 minutes' });
      }

      const ownerPrefix = ownerEmail.replace(/[^a-z0-9._-]/g, '_');
      const storedFileName = `${ownerPrefix}__${fileName}`;

      fs.writeFileSync(
        path.join(SOUNDS_DIR, storedFileName),
        Buffer.from(base64, 'base64')
      );

      const index = readSoundIndex();
      const existing = (index.sounds || []).filter(s => s.name !== storedFileName);
      const cleanLabel = String(body.label || '').trim();

      const newSound = {
        name: storedFileName,
        original_name: fileName,
        label: cleanLabel || fileName.replace(/\.[^.]+$/, ''),
        duration_ms: Number(body.duration_ms || 0),
        owner_email: ownerEmail,
      };

      writeSoundIndex({
        sounds: [...existing, newSound],
      });

      return send(res, 200, {
        ok: true,
        sound: storedFileName,
        metadata: newSound,
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/sounds/')) {
      const fileName = path.basename(
        decodeURIComponent(url.pathname.replace('/api/sounds/', ''))
      );

      const filePath = path.join(SOUNDS_DIR, fileName);

      if (!fs.existsSync(filePath)) {
        return send(res, 404, { error: 'Sound not found' });
      }

      const ext = path.extname(fileName).toLowerCase();
      const type = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';

      res.writeHead(200, {
        'Content-Type': type,
        'Access-Control-Allow-Origin': '*',
      });

      return fs.createReadStream(filePath).pipe(res);
    }

    if (req.method === 'GET' && url.pathname === '/api/logs') {
      return send(res, 200, { logs: readLogs() });
    }

    if (req.method === 'POST' && url.pathname === '/api/log') {
      const logStart = Date.now();
      console.log("  └─ /api/log handler ENTER", logStart);

      const body = await readJsonBody(req);

      console.log("  └─ JSON parsed", Date.now());

      const ownerEmail = cleanOwnerEmail(body.owner_email || body.ownerEmail || '');
      const config = readConfig(ownerEmail);

      const button = Number(body.button);

      const soundfile =
        String(body.soundfile || config[button] || '');

      const timestamp =
        String(body.timestamp || new Date().toISOString());

      const msSinceLastSound =
        Number(body.ms_since_last_sound || 0);

      console.log("  └─ BEFORE appendLog", Date.now());

      appendLog({
        button,
        soundfile,
        timestamp,
        owner_email: ownerEmail,
        ms_since_last_sound: msSinceLastSound,
      });

      console.log("  └─ AFTER appendLog (CSV written)", Date.now());

      return send(res, 200, {
        ok: true,
        button,
        soundfile,
        timestamp,
        owner_email: ownerEmail,
        ms_since_last_sound: msSinceLastSound,
      });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    return send(res, 500, { error: error.message });
  }
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Parrot device API running on port ${PORT}`);
});