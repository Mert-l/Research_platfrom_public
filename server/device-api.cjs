const http = require("http");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env.local") });
require("dotenv").config();

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecret =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseSecret) {
  console.log("Current working directory:", process.cwd());
  console.log("SUPABASE_URL exists:", !!supabaseUrl);
  console.log("SUPABASE_SECRET_KEY exists:", !!supabaseSecret);

  throw new Error(
    "Missing SUPABASE_URL and SUPABASE_SECRET_KEY. Check that .env.local exists in the project root and that dotenv is loaded at the top of server/device-api.cjs."
  );
}

const supabase = createClient(supabaseUrl, supabaseSecret);

if (!supabaseUrl || !supabaseSecret) {
  throw new Error("Missing SUPABASE_URL and SUPABASE_SECRET_KEY Railway variables");
}

const supabaseAdmin = createClient(supabaseUrl, supabaseSecret, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const SOUND_BUCKET = "parrot-sounds";
const PHOTO_BUCKET = "parrot-photos";

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
    .select("name, label, file_path, public_url, duration_ms, owner_email, created_at")
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

async function removeStorageFolder(bucket, folder) {
  const { data, error } = await supabaseAdmin.storage.from(bucket).list(folder, {
    limit: 1000,
  });

  if (error) {
    // If the bucket or folder does not exist, do not stop account deletion.
    console.warn(`Could not list ${bucket}/${folder}:`, error.message || error);
    return;
  }

  const files = (data || [])
    .filter((item) => item.name)
    .map((item) => `${folder}/${item.name}`);

  if (files.length === 0) return;

  const { error: removeError } = await supabaseAdmin.storage
    .from(bucket)
    .remove(files);

  if (removeError) {
    console.warn(`Could not remove files from ${bucket}/${folder}:`, removeError.message || removeError);
  }
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

    if (req.method === "POST" && url.pathname === "/api/research-login") {
      const body = await readJsonBody(req);
      const expectedPassword = String(process.env.RESEARCHER_PASSWORD || "");
      const suppliedPassword = String(body.password || "");

      if (!expectedPassword) {
        return send(res, 500, {
          error: "Missing RESEARCHER_PASSWORD Railway variable",
        });
      }

      if (suppliedPassword !== expectedPassword) {
        return send(res, 401, {
          error: "Wrong researcher password",
        });
      }

      return send(res, 200, { ok: true });
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

      const soundNames = sounds.map((sound) => fileNameFromPath(sound.file_path));

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
        file_path: sound.file_path,
        public_url: sound.public_url,
        duration_ms: Number(sound.duration_ms || 0),
      }));

      return send(res, 200, {
        owner_email: ownerEmail,
        sounds,
      });
    }

    /*
     * Delete one sound from a user's library and clear any buttons using it.
     */
    if (req.method === "POST" && url.pathname === "/api/sounds/delete") {
      const body = await readJsonBody(req);
      const ownerEmail = ownerEmailFromRequest(url, body);
      const filePath = String(body.file_path || body.filePath || "").trim();

      if (!ownerEmail) {
        return send(res, 400, { error: "Missing owner_email" });
      }

      if (!filePath) {
        return send(res, 400, { error: "Missing file_path" });
      }

      if (!filePath.startsWith(`${ownerEmail}/`)) {
        return send(res, 403, {
          error: "This sound does not belong to the requested owner",
        });
      }

      const currentConfig = await loadOwnerConfig(ownerEmail);
      const nextConfig = Object.fromEntries(
        Object.entries(currentConfig).map(([button, value]) => [
          button,
          value === filePath ? "" : value,
        ])
      );

      const { error: configError } = await supabaseAdmin
        .from("device_configs")
        .upsert(
          {
            owner_email: ownerEmail,
            buttons: nextConfig,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "owner_email" }
        );

      if (configError) throw configError;

      const { error: dbError } = await supabaseAdmin
        .from("sound_files")
        .delete()
        .eq("owner_email", ownerEmail)
        .eq("file_path", filePath);

      if (dbError) throw dbError;

      const { error: storageError } = await supabaseAdmin.storage
        .from(SOUND_BUCKET)
        .remove([filePath]);

      if (storageError) {
        console.warn("Could not remove sound from storage:", storageError.message || storageError);
      }

      return send(res, 200, {
        ok: true,
        owner_email: ownerEmail,
        deleted_file_path: filePath,
        buttons: nextConfig,
      });
    }

    /*
     * Delete an owner profile and all data that belongs to it.
     */
    if (req.method === "POST" && url.pathname === "/api/profile/delete") {
      const body = await readJsonBody(req);
      const ownerEmail = ownerEmailFromRequest(url, body);

      if (!ownerEmail) {
        return send(res, 400, { error: "Missing owner_email" });
      }

      const sounds = await loadOwnerSounds(ownerEmail);
      const soundPaths = sounds.map((sound) => sound.file_path).filter(Boolean);

      if (soundPaths.length > 0) {
        const { error: storageError } = await supabaseAdmin.storage
          .from(SOUND_BUCKET)
          .remove(soundPaths);

        if (storageError) {
          console.warn("Could not remove one or more sound files:", storageError.message || storageError);
        }
      }

      await removeStorageFolder(PHOTO_BUCKET, ownerEmail);

      const deleteOperations = [
        supabaseAdmin.from("device_configs").delete().eq("owner_email", ownerEmail),
        supabaseAdmin.from("device_logs").delete().eq("owner_email", ownerEmail),
        supabaseAdmin.from("sound_files").delete().eq("owner_email", ownerEmail),
        supabaseAdmin.from("profiles").delete().eq("email", ownerEmail),
      ];

      const results = await Promise.all(deleteOperations);
      const firstError = results.find((result) => result.error)?.error;

      if (firstError) throw firstError;

      return send(res, 200, {
        ok: true,
        deleted_owner_email: ownerEmail,
      });
    }

    /*
     * Download one owner's sound from Supabase Storage.
     */
    if (req.method === "GET" && url.pathname.startsWith("/api/sounds/")) {
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

      const contentType = extension === ".mp3" ? "audio/mpeg" : "audio/wav";

      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": buffer.length,
        "Access-Control-Allow-Origin": "*",
      });

      return res.end(buffer);
    }

    /*
     * Return all logs for the researcher, or one owner's logs when an email is supplied.
     */
    if (req.method === "GET" && url.pathname === "/api/logs") {
      const ownerEmail = ownerEmailFromRequest(url);

      let query = supabaseAdmin
        .from("device_logs")
        .select("id, owner_email, device_id, button, soundfile, pressed_at, ms_since_last_sound")
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
        fileNameFromPath(body.soundfile) || fileNameFromPath(configuredSoundPath);

      const pressedAt = normalizeTimestamp(body.timestamp);
      const msSinceLastSound = Number(body.ms_since_last_sound || 0);
      const deviceId = String(body.device_id || body.deviceId || "").trim();

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
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Parrot device API running on port ${PORT}`);
});
