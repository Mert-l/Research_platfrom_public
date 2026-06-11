const http = require("http");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecret =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseSecret) {
  throw new Error(
    "Missing SUPABASE_URL and SUPABASE_SECRET_KEY Railway variables"
  );
}

const supabaseAdmin = createClient(supabaseUrl, supabaseSecret, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const SOUND_BUCKET = "parrot-sounds";

function send(res, status, data, contentType = "application/json") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });

  if (contentType === "application/json") {
    res.end(JSON.stringify(data));
    return;
  }

  res.end(data);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });

    req.on("error", reject);
  });
}

function cleanOwnerEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function ownerEmailFromRequest(url, body = {}) {
  return cleanOwnerEmail(
    body.owner_email ||
      body.ownerEmail ||
      url.searchParams.get("owner_email") ||
      url.searchParams.get("ownerEmail") ||
      url.searchParams.get("email") ||
      ""
  );
}

function emptyConfig() {
  return {
    "1": "",
    "2": "",
    "3": "",
    "4": "",
  };
}

function cleanConfig(config = {}) {
  return {
    "1": String(config["1"] || config[1] || ""),
    "2": String(config["2"] || config[2] || ""),
    "3": String(config["3"] || config[3] || ""),
    "4": String(config["4"] || config[4] || ""),
  };
}

function fileNameFromPath(filePath) {
  if (!filePath) return "";
  return path.posix.basename(String(filePath).replace(/\\/g, "/"));
}

function normalizeTimestamp(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return new Date().toISOString();
  }

  const numericValue = Number(raw);

  if (!Number.isNaN(numericValue)) {
    const milliseconds =
      numericValue < 1000000000000 ? numericValue * 1000 : numericValue;

    const date = new Date(milliseconds);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const parsed = Date.parse(raw);

  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }

  return new Date().toISOString();
}

async function loadOwnerConfig(ownerEmail) {
  const { data, error } = await supabaseAdmin
    .from("device_configs")
    .select("buttons")
    .eq("owner_email", ownerEmail)
    .maybeSingle();

  if (error) throw error;

  return cleanConfig(data?.buttons || emptyConfig());
}

async function loadOwnerSounds(ownerEmail) {
  const { data, error } = await supabaseAdmin
    .from("sound_files")
    .select(
      "name, label, file_path, public_url, duration_ms, owner_email, created_at"
    )
    .eq("owner_email", ownerEmail)
    .order("created_at", { ascending: false });

  if (error) throw error;

  return data || [];
}

async function findOwnerSound(ownerEmail, requestedName) {
  const sounds = await loadOwnerSounds(ownerEmail);

  return sounds.find(
    (sound) => fileNameFromPath(sound.file_path) === requestedName
  );
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      return send(res, 204, {});
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, {
        ok: true,
        name: "parrot-device-api",
        storage: "supabase",
      });
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, {
        ok: true,
        name: "parrot-device-api",
        storage: "supabase",
      });
    }

    /*
     * Return one owner's button configuration to the physical device.
     */
    if (req.method === "GET" && url.pathname === "/api/config") {
      const ownerEmail = ownerEmailFromRequest(url);

      if (!ownerEmail) {
        return send(res, 400, {
          error: "Missing owner_email",
        });
      }

      const storedButtons = await loadOwnerConfig(ownerEmail);

      const buttons = Object.fromEntries(
        Object.entries(storedButtons).map(([button, filePath]) => [
          button,
          fileNameFromPath(filePath),
        ])
      );

      return send(res, 200, {
        owner_email: ownerEmail,
        buttons,
      });
    }

    /*
     * Save an owner's button configuration.
     * The website currently saves directly to Supabase, but this endpoint
     * remains available for other clients.
     */
    if (req.method === "POST" && url.pathname === "/api/config") {
      const body = await readJsonBody(req);
      const ownerEmail = ownerEmailFromRequest(url, body);

      if (!ownerEmail) {
        return send(res, 400, {
          error: "Missing owner_email",
        });
      }

      const buttons = cleanConfig(body.buttons || body);

      const { error } = await supabaseAdmin.from("device_configs").upsert(
        {
          owner_email: ownerEmail,
          buttons,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "owner_email",
        }
      );

      if (error) throw error;

      return send(res, 200, {
        ok: true,
        owner_email: ownerEmail,
        buttons,
      });
    }

    /*
     * Compatibility endpoint containing both button filenames and tracks.
     */
    if (req.method === "GET" && url.pathname === "/api/device-config") {
      const ownerEmail = ownerEmailFromRequest(url);

      if (!ownerEmail) {
        return send(res, 400, {
          error: "Missing owner_email",
        });
      }

      const storedButtons = await loadOwnerConfig(ownerEmail);
      const sounds = await loadOwnerSounds(ownerEmail);

      const soundNames = sounds.map((sound) =>
        fileNameFromPath(sound.file_path)
      );

      const buttons = Object.fromEntries(
        Object.entries(storedButtons).map(([button, filePath]) => [
          button,
          fileNameFromPath(filePath),
        ])
      );

      const tracks = {};

      [1, 2, 3, 4].forEach((button) => {
        const soundName = buttons[String(button)] || "";
        const index = soundNames.indexOf(soundName);
        tracks[String(button)] = index >= 0 ? index + 1 : 0;
      });

      return send(res, 200, {
        owner_email: ownerEmail,
        buttons,
        tracks,
      });
    }

    /*
     * Return only sounds belonging to the requested owner.
     */
    if (req.method === "GET" && url.pathname === "/api/sounds") {
      const ownerEmail = ownerEmailFromRequest(url);

      if (!ownerEmail) {
        return send(res, 400, {
          error: "Missing owner_email",
        });
      }

      const storedSounds = await loadOwnerSounds(ownerEmail);

      const sounds = storedSounds.map((sound) => ({
        name: fileNameFromPath(sound.file_path),
        label:
          sound.label ||
          sound.name ||
          fileNameFromPath(sound.file_path).replace(/\.[^.]+$/, ""),
        duration_ms: Number(sound.duration_ms || 0),
      }));

      return send(res, 200, {
        owner_email: ownerEmail,
        sounds,
      });
    }

    /*
     * Download one owner's sound from Supabase Storage.
     */
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/sounds/")
    ) {
      const ownerEmail = ownerEmailFromRequest(url);

      if (!ownerEmail) {
        return send(res, 400, {
          error: "Missing owner_email",
        });
      }

      const requestedName = path.basename(
        decodeURIComponent(url.pathname.replace("/api/sounds/", ""))
      );

      const sound = await findOwnerSound(ownerEmail, requestedName);

      if (!sound) {
        return send(res, 404, {
          error: "Sound not found for this owner",
        });
      }

      const { data: file, error } = await supabaseAdmin.storage
        .from(SOUND_BUCKET)
        .download(sound.file_path);

      if (error) throw error;

      const buffer = Buffer.from(await file.arrayBuffer());
      const extension = path.extname(requestedName).toLowerCase();

      const contentType =
        extension === ".mp3" ? "audio/mpeg" : "audio/wav";

      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": buffer.length,
        "Access-Control-Allow-Origin": "*",
      });

      return res.end(buffer);
    }

    /*
     * Return all logs for the researcher, or one owner's logs when an email
     * is supplied.
     */
    if (req.method === "GET" && url.pathname === "/api/logs") {
      const ownerEmail = ownerEmailFromRequest(url);

      let query = supabaseAdmin
        .from("device_logs")
        .select(
          "id, owner_email, device_id, button, soundfile, pressed_at, ms_since_last_sound"
        )
        .order("pressed_at", { ascending: false });

      if (ownerEmail) {
        query = query.eq("owner_email", ownerEmail);
      }

      const { data, error } = await query;

      if (error) throw error;

      const logs = (data || []).map((log) => ({
        id: log.id,
        timestamp: log.pressed_at,
        owner_email: log.owner_email,
        device_id: log.device_id,
        button: Number(log.button),
        soundfile: log.soundfile || "",
        ms_since_last_sound: Number(log.ms_since_last_sound || 0),
      }));

      return send(res, 200, {
        logs,
      });
    }

    /*
     * Receive a physical button press from the Arduino.
     */
    if (req.method === "POST" && url.pathname === "/api/log") {
      const body = await readJsonBody(req);
      const ownerEmail = ownerEmailFromRequest(url, body);
      const button = Number(body.button);

      if (!ownerEmail) {
        return send(res, 400, {
          error: "Missing owner_email",
        });
      }

      if (![1, 2, 3, 4].includes(button)) {
        return send(res, 400, {
          error: "Button must be between 1 and 4",
        });
      }

      const ownerConfig = await loadOwnerConfig(ownerEmail);

      const configuredSoundPath = ownerConfig[String(button)] || "";

      const soundfile =
        fileNameFromPath(body.soundfile) ||
        fileNameFromPath(configuredSoundPath);

      const pressedAt = normalizeTimestamp(body.timestamp);
      const msSinceLastSound = Number(
        body.ms_since_last_sound || 0
      );

      const deviceId = String(
        body.device_id || body.deviceId || ""
      ).trim();

      const { data, error } = await supabaseAdmin
        .from("device_logs")
        .insert({
          owner_email: ownerEmail,
          device_id: deviceId || null,
          button,
          soundfile,
          pressed_at: pressedAt,
          ms_since_last_sound: Number.isFinite(msSinceLastSound)
            ? msSinceLastSound
            : 0,
        })
        .select()
        .single();

      if (error) throw error;

      return send(res, 200, {
        ok: true,
        id: data.id,
        owner_email: ownerEmail,
        device_id: data.device_id,
        button,
        soundfile,
        timestamp: data.pressed_at,
        ms_since_last_sound: data.ms_since_last_sound,
      });
    }

    return send(res, 404, {
      error: "Not found",
    });
  } catch (error) {
    console.error(error);

    return send(res, 500, {
      error:
        error instanceof Error
          ? error.message
          : "Internal server error",
    });
  }
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Parrot device API running on port ${PORT}`);
});