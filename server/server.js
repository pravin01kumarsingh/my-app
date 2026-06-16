const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const multer = require("multer");

const PORT = Number(process.env.PORT) || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-change-me-use-env-in-production";
const MAX_FILE = 45 * 1024 * 1024;

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const UPLOAD_ROOT = path.join(__dirname, "uploads");
const DB_PATH = path.join(__dirname, "data.sqlite");

fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transporters (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  details TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS gps_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_letter_text TEXT NOT NULL DEFAULT '',
  request_letter_path TEXT,
  request_letter_name TEXT,
  request_letter_mime TEXT,
  deregister_letter_text TEXT NOT NULL DEFAULT '',
  deregister_letter_path TEXT,
  deregister_letter_name TEXT,
  deregister_letter_mime TEXT,
  request_date TEXT,
  email_sent INTEGER NOT NULL DEFAULT 0,
  transporter TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  vehicle_no TEXT,
  gps_installed INTEGER NOT NULL DEFAULT 0,
  installation_date TEXT,
  imei TEXT NOT NULL DEFAULT '',
  signature TEXT NOT NULL DEFAULT '',
  removal_request_date TEXT,
  deregistration_date TEXT,
  gps_submitted INTEGER NOT NULL DEFAULT 0,
  received_by TEXT NOT NULL DEFAULT '',
  gps_kept_at TEXT NOT NULL DEFAULT '',
  portal_updated INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gps_user ON gps_records(user_id);
CREATE INDEX IF NOT EXISTS idx_gps_vehicle ON gps_records(vehicle_no) WHERE vehicle_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gps_imei ON gps_records(imei) WHERE imei != '';
`);

// Migration for existing databases
try {
  db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
} catch (e) {
  // Column might already exist
}
try {
  db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
} catch (e) {
  // Column might already exist
}
try {
  db.exec("ALTER TABLE gps_records ADD COLUMN transporter TEXT NOT NULL DEFAULT ''");
} catch (e) {
  // Column might already exist
}
try {
  db.exec("ALTER TABLE gps_records ADD COLUMN project TEXT NOT NULL DEFAULT ''");
} catch (e) {
  // Column might already exist
}
try {
  db.exec("ALTER TABLE gps_records ADD COLUMN gps_kept_at TEXT NOT NULL DEFAULT ''");
} catch (e) {
  // Column might already exist
}

// Support nullable vehicle_no for stock
try {
  // SQLite doesn't support ALTER COLUMN to remove NOT NULL easily.
  // But we can check if it's already nullable or just ignore if it fails.
  // For new tables it will be nullable due to the CREATE TABLE above.
} catch (e) {}

// Create indexes that might depend on migrated columns
try {
  db.exec("CREATE INDEX IF NOT EXISTS idx_gps_project ON gps_records(project)");
} catch (e) {
  // Index might already exist
}

// Seed default admin if no users
const userCount = db.prepare("SELECT count(*) as count FROM users").get().count;
if (userCount === 0) {
  const id = crypto.randomUUID();
  const hash = bcrypt.hashSync("admin", 10);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    "admin",
    hash,
    "admin",
    1,
    now
  );
  console.log("Default admin user created (admin:admin)");
}

const app = express();

app.use(
  session({
    name: "gps.sid",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(express.json({ limit: "512kb" }));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  req.userId = req.session.userId;
  req.userRole = req.session.role;
  req.mustChangePassword = Boolean(req.session.mustChangePassword);
  next();
}

function enforcePasswordChange(req, res, next) {
  requireAuth(req, res, () => {
    if (req.mustChangePassword) {
      return res.status(403).json({ error: "Password change required", mustChangePassword: true });
    }
    next();
  });
}

function requireAdmin(req, res, next) {
  enforcePasswordChange(req, res, () => {
    if (req.userRole !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  });
}

function rowToRecord(row) {
  return {
    id: row.id,
    requestLetterText: row.request_letter_text || "",
    requestLetterAttachment:
      row.request_letter_path && row.request_letter_name
        ? { fileName: row.request_letter_name, mimeType: row.request_letter_mime || "application/octet-stream" }
        : null,
    requestDate: row.request_date || "",
    emailSent: Boolean(row.email_sent),
    transporter: row.transporter || "",
    project: row.project || "",
    vehicleNo: row.vehicle_no || "",
    gpsInstalled: Boolean(row.gps_installed),
    installationDate: row.installation_date || "",
    imei: row.imei || "",
    signature: row.signature || "",
    deregisterLetterText: row.deregister_letter_text || "",
    deregisterLetterAttachment:
      row.deregister_letter_path && row.deregister_letter_name
        ? { fileName: row.deregister_letter_name, mimeType: row.deregister_letter_mime || "application/octet-stream" }
        : null,
    removalRequestDate: row.removal_request_date || "",
    deregistrationDate: row.deregistration_date || "",
    gpsSubmitted: Boolean(row.gps_submitted),
    receivedBy: row.received_by || "",
    gpsKeptAt: row.gps_kept_at || "",
    portalUpdated: Boolean(row.portal_updated),
  };
}

function absUpload(rel) {
  if (!rel || typeof rel !== "string" || rel.includes("..")) return null;
  const full = path.join(UPLOAD_ROOT, rel);
  if (!full.startsWith(UPLOAD_ROOT)) return null;
  return full;
}

function unlinkRel(rel) {
  const full = absUpload(rel);
  if (full && fs.existsSync(full)) {
    try {
      fs.unlinkSync(full);
    } catch {
      /* ignore */
    }
  }
}

function allowedMime(mime, originalname) {
  if (mime === "application/pdf") return true;
  if (mime && mime.startsWith("image/")) return true;
  const n = (originalname || "").toLowerCase();
  if (n.endsWith(".pdf")) return true;
  return /\.(png|jpe?g|gif|webp|heic|heif|bmp|tif{1,2})$/i.test(n);
}

function pickExt(originalname, mime) {
  const ext = path.extname(originalname || "").toLowerCase();
  if (ext && ext.length <= 8) return ext;
  if (mime === "application/pdf") return ".pdf";
  if (mime && mime.startsWith("image/")) {
    const sub = mime.split("/")[1] || "bin";
    return "." + sub.replace("jpeg", "jpg").slice(0, 6);
  }
  return ".bin";
}

function saveUploadedBuffer(userId, recordId, slot, buffer, originalname, mime) {
  const dir = path.join(UPLOAD_ROOT, userId);
  fs.mkdirSync(dir, { recursive: true });
  const tag = slot === "requestLetter" ? "request" : "deregister";
  const ext = pickExt(originalname, mime);
  const rel = path.posix.join(userId, `${recordId}_${tag}${ext}`);
  const full = path.join(UPLOAD_ROOT, userId, `${recordId}_${tag}${ext}`);
  fs.writeFileSync(full, buffer);
  return rel.replace(/\\/g, "/");
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE },
});

const letterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE },
  fileFilter(req, file, cb) {
    if (file.fieldname === "requestLetterFile" || file.fieldname === "deregisterLetterFile") {
      if (!allowedMime(file.mimetype, file.originalname)) {
        return cb(new Error("Only PDF or image files are allowed"));
      }
    }
    cb(null, true);
  },
}).any();

function letterUploadGuard(req, res, next) {
  letterUpload(req, res, (err) => {
    if (err) return next(err);
    const files = req.files || [];
    for (const f of files) {
      if (f.fieldname !== "requestLetterFile" && f.fieldname !== "deregisterLetterFile") {
        return res.status(400).json({ error: `Unexpected upload field: ${f.fieldname}` });
      }
    }
    next();
  });
}

function parseRecordData(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  return {
    requestLetterText: String(data.requestLetterText ?? "").toUpperCase(),
    requestDate: String(data.requestDate ?? ""),
    emailSent: Boolean(data.emailSent),
    transporter: String(data.transporter ?? "").trim().toUpperCase(),
    project: String(data.project ?? "").trim().toUpperCase(),
    vehicleNo: data.vehicleNo ? String(data.vehicleNo).trim().toUpperCase() : null,
    gpsInstalled: Boolean(data.gpsInstalled),
    installationDate: String(data.installationDate ?? ""),
    imei: String(data.imei ?? "").toUpperCase(),
    signature: String(data.signature ?? "").toUpperCase(),
    deregisterLetterText: String(data.deregisterLetterText ?? "").toUpperCase(),
    removalRequestDate: String(data.removalRequestDate ?? ""),
    deregistrationDate: String(data.deregistrationDate ?? ""),
    gpsSubmitted: Boolean(data.gpsSubmitted),
    receivedBy: String(data.receivedBy ?? "").toUpperCase(),
    gpsKeptAt: String(data.gpsKeptAt ?? "").toUpperCase(),
    portalUpdated: Boolean(data.portalUpdated),
    removeRequestLetter: Boolean(data.removeRequestLetter),
    removeDeregisterLetter: Boolean(data.removeDeregisterLetter),
  };
}

app.post("/api/auth/register", (req, res) => {
  try {
    const userCount = db.prepare("SELECT count(*) as count FROM users").get().count;
    // If there are users, registration requires admin
    if (userCount > 0) {
      if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
      if (req.session.role !== "admin") return res.status(403).json({ error: "Admin access required" });
    }

    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const role = userCount === 0 ? "admin" : (String(req.body.role || "user"));

    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(username)) {
      return res.status(400).json({ error: "Username must be 3–32 characters (letters, numbers, . _ -)" });
    }
    if (password.length < 5) {
      return res.status(400).json({ error: "Password must be at least 5 characters" });
    }
    const id = crypto.randomUUID();
    const hash = bcrypt.hashSync(password, 10);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (id, username, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      id,
      username,
      hash,
      role,
      1,
      now
    );
    
    // If it's the first user, log them in automatically
    if (userCount === 0) {
      req.session.userId = id;
      req.session.username = username;
      req.session.role = role;
      req.session.mustChangePassword = true;
    }

    return res.json({ user: { id, username, role } });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Username already taken" });
    }
    console.error(e);
    return res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.role = user.role;
  req.session.mustChangePassword = Boolean(user.must_change_password);
  return res.json({ 
    user: { 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      mustChangePassword: Boolean(user.must_change_password) 
    } 
  });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("gps.sid");
    res.json({ ok: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  return res.json({ 
    user: { 
      id: req.session.userId, 
      username: req.session.username, 
      role: req.session.role,
      mustChangePassword: Boolean(req.session.mustChangePassword)
    } 
  });
});

app.get("/api/records", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM gps_records ORDER BY created_at ASC").all();
  res.json({ records: rows.map(rowToRecord) });
});

app.get("/api/records/:id/attachment/:slot", requireAuth, (req, res) => {
  const { id, slot } = req.params;
  if (slot !== "requestLetter" && slot !== "deregisterLetter") {
    return res.status(400).send("Bad slot");
  }
  const row = db.prepare("SELECT * FROM gps_records WHERE id = ?").get(id);
  if (!row) return res.status(404).send("Not found");
  const rel = slot === "requestLetter" ? row.request_letter_path : row.deregister_letter_path;
  const mime = slot === "requestLetter" ? row.request_letter_mime : row.deregister_letter_mime;
  const name = slot === "requestLetter" ? row.request_letter_name : row.deregister_letter_name;
  const full = absUpload(rel);
  if (!full || !fs.existsSync(full)) return res.status(404).send("File missing");
  res.setHeader("Content-Type", mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(name || "file")}`);
  return res.sendFile(full);
});

app.post("/api/records", requireAdmin, letterUploadGuard, (req, res) => {
  try {
    let data;
    try {
      data = parseRecordData(req.body.data);
    } catch {
      return res.status(400).json({ error: "Invalid data JSON" });
    }
    if (!data.vehicleNo && !data.imei) {
      return res.status(400).json({ error: "Vehicle number or IMEI is required" });
    }

    // Duplicate check
    if (data.vehicleNo) {
      const existingVehicle = db.prepare("SELECT id FROM gps_records WHERE vehicle_no = ?").get(data.vehicleNo);
      if (existingVehicle) {
        return res.status(409).json({ error: `Vehicle number ${data.vehicleNo} is already registered` });
      }
    }
    if (data.imei) {
      const existingImei = db.prepare("SELECT id FROM gps_records WHERE imei = ?").get(data.imei);
      if (existingImei) {
        return res.status(409).json({ error: `IMEI number ${data.imei} is already registered` });
      }
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    let rlPath = null;
    let rlName = null;
    let rlMime = null;
    let dlPath = null;
    let dlName = null;
    let dlMime = null;

    const files = req.files || [];
    const rlFile = files.find((f) => f.fieldname === "requestLetterFile");
    const dlFile = files.find((f) => f.fieldname === "deregisterLetterFile");

    if (data.removeRequestLetter) {
      /* no existing row */
    } else if (rlFile) {
      rlPath = saveUploadedBuffer(req.userId, id, "requestLetter", rlFile.buffer, rlFile.originalname, rlFile.mimetype);
      rlName = rlFile.originalname || "request-letter";
      rlMime = rlFile.mimetype || "application/octet-stream";
    }

    if (data.removeDeregisterLetter) {
      /* noop */
    } else if (dlFile) {
      dlPath = saveUploadedBuffer(req.userId, id, "deregisterLetter", dlFile.buffer, dlFile.originalname, dlFile.mimetype);
      dlName = dlFile.originalname || "deregister-letter";
      dlMime = dlFile.mimetype || "application/octet-stream";
    }

    db.prepare(
      `INSERT INTO gps_records (
        id, user_id, request_letter_text, request_letter_path, request_letter_name, request_letter_mime,
        deregister_letter_text, deregister_letter_path, deregister_letter_name, deregister_letter_mime,
        request_date, email_sent, transporter, project, vehicle_no, gps_installed, installation_date, imei, signature,
        removal_request_date, deregistration_date, gps_submitted, received_by, gps_kept_at, portal_updated,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id,
      req.userId,
      data.requestLetterText,
      rlPath,
      rlName,
      rlMime,
      data.deregisterLetterText,
      dlPath,
      dlName,
      dlMime,
      data.requestDate || null,
      data.emailSent ? 1 : 0,
      data.transporter,
      data.project,
      data.vehicleNo,
      data.gpsInstalled ? 1 : 0,
      data.installationDate || null,
      data.imei,
      data.signature,
      data.removalRequestDate || null,
      data.deregistrationDate || null,
      data.gpsSubmitted ? 1 : 0,
      data.receivedBy,
      data.gpsKeptAt,
      data.portalUpdated ? 1 : 0,
      now,
      now
    );

    const row = db.prepare("SELECT * FROM gps_records WHERE id = ?").get(id);
    return res.status(201).json({ record: rowToRecord(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not create record" });
  }
});

app.post("/api/records/bulk", requireAdmin, (req, res) => {
  try {
    const { count, project, transporter, imeiPrefix, startImei } = req.body;
    const n = parseInt(count);
    if (isNaN(n) || n <= 0) return res.status(400).json({ error: "Invalid count" });
    if (n > 500) return res.status(400).json({ error: "Max 500 records at once" });

    const now = new Date().toISOString();
    const insert = db.prepare(
      `INSERT INTO gps_records (
        id, user_id, transporter, project, imei, gps_submitted, created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?)`
    );

    const transaction = db.transaction((items) => {
      for (const item of items) {
        insert.run(item.id, req.userId, item.transporter, item.project, item.imei, 1, now, now);
      }
    });

    const items = [];
    let currentImei = parseInt(startImei);
    for (let i = 0; i < n; i++) {
      let imei = "";
      if (!isNaN(currentImei)) {
        imei = (imeiPrefix || "") + (currentImei + i).toString();
      }
      items.push({
        id: crypto.randomUUID(),
        transporter: (transporter || "").trim().toUpperCase(),
        project: (project || "").trim().toUpperCase(),
        imei: imei
      });
    }

    transaction(items);
    res.json({ ok: true, count: n });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Bulk add failed" });
  }
});

app.put("/api/records/:id", requireAdmin, letterUploadGuard, (req, res) => {
  try {
    const id = req.params.id;
    const existing = db.prepare("SELECT * FROM gps_records WHERE id = ?").get(id);
    if (!existing) {
      return res.status(404).json({ error: "Record not found" });
    }

    let data;
    try {
      data = parseRecordData(req.body.data);
    } catch {
      return res.status(400).json({ error: "Invalid data JSON" });
    }
    if (!data.vehicleNo) {
      return res.status(400).json({ error: "Vehicle number is required" });
    }

    // Duplicate check
    const existingVehicle = db.prepare("SELECT id FROM gps_records WHERE vehicle_no = ? AND id != ?").get(data.vehicleNo, id);
    if (existingVehicle) {
      return res.status(409).json({ error: `Vehicle number ${data.vehicleNo} is already registered` });
    }
    if (data.imei) {
      const existingImei = db.prepare("SELECT id FROM gps_records WHERE imei = ? AND id != ?").get(data.imei, id);
      if (existingImei) {
        return res.status(409).json({ error: `IMEI number ${data.imei} is already registered` });
      }
    }

    const files = req.files || [];
    const rlFile = files.find((f) => f.fieldname === "requestLetterFile");
    const dlFile = files.find((f) => f.fieldname === "deregisterLetterFile");

    let rlPath = existing.request_letter_path;
    let rlName = existing.request_letter_name;
    let rlMime = existing.request_letter_mime;
    let dlPath = existing.deregister_letter_path;
    let dlName = existing.deregister_letter_name;
    let dlMime = existing.deregister_letter_mime;

    if (data.removeRequestLetter) {
      unlinkRel(existing.request_letter_path);
      rlPath = rlName = rlMime = null;
    } else if (rlFile) {
      unlinkRel(existing.request_letter_path);
      rlPath = saveUploadedBuffer(req.userId, id, "requestLetter", rlFile.buffer, rlFile.originalname, rlFile.mimetype);
      rlName = rlFile.originalname || "request-letter";
      rlMime = rlFile.mimetype || "application/octet-stream";
    }

    if (data.removeDeregisterLetter) {
      unlinkRel(existing.deregister_letter_path);
      dlPath = dlName = dlMime = null;
    } else if (dlFile) {
      unlinkRel(existing.deregister_letter_path);
      dlPath = saveUploadedBuffer(req.userId, id, "deregisterLetter", dlFile.buffer, dlFile.originalname, dlFile.mimetype);
      dlName = dlFile.originalname || "deregister-letter";
      dlMime = dlFile.mimetype || "application/octet-stream";
    }

    const now = new Date().toISOString();
    db.prepare(
      `UPDATE gps_records SET
        request_letter_text = ?, request_letter_path = ?, request_letter_name = ?, request_letter_mime = ?,
        deregister_letter_text = ?, deregister_letter_path = ?, deregister_letter_name = ?, deregister_letter_mime = ?,
        request_date = ?, email_sent = ?, transporter = ?, project = ?, vehicle_no = ?, gps_installed = ?, installation_date = ?,
        imei = ?, signature = ?, removal_request_date = ?, deregistration_date = ?,
        gps_submitted = ?, received_by = ?, gps_kept_at = ?, portal_updated = ?, updated_at = ?
      WHERE id = ?`
    ).run(
      data.requestLetterText,
      rlPath,
      rlName,
      rlMime,
      data.deregisterLetterText,
      dlPath,
      dlName,
      dlMime,
      data.requestDate || null,
      data.emailSent ? 1 : 0,
      data.transporter,
      data.project,
      data.vehicleNo,
      data.gpsInstalled ? 1 : 0,
      data.installationDate || null,
      data.imei,
      data.signature,
      data.removalRequestDate || null,
      data.deregistrationDate || null,
      data.gpsSubmitted ? 1 : 0,
      data.receivedBy,
      data.gpsKeptAt,
      data.portalUpdated ? 1 : 0,
      now,
      id
    );

    const row = db.prepare("SELECT * FROM gps_records WHERE id = ?").get(id);
    return res.json({ record: rowToRecord(row) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Could not update record" });
  }
});

app.delete("/api/records/:id", requireAdmin, (req, res) => {
  const id = req.params.id;
  const row = db.prepare("SELECT * FROM gps_records WHERE id = ?").get(id);
  if (!row) return res.status(404).json({ error: "Not found" });
  unlinkRel(row.request_letter_path);
  unlinkRel(row.deregister_letter_path);
  db.prepare("DELETE FROM gps_records WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.delete("/api/records", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM gps_records").all();
  for (const row of rows) {
    unlinkRel(row.request_letter_path);
    unlinkRel(row.deregister_letter_path);
  }
  db.prepare("DELETE FROM gps_records").run();
  res.json({ ok: true });
});

app.get("/api/admin/users", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT id, username, role, created_at FROM users").all();
  res.json({ users: rows });
});

app.put("/api/admin/users/:id/password", requireAdmin, (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  if (!password || password.length < 5) {
    return res.status(400).json({ error: "Password must be at least 5 characters" });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  const info = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  if (info.changes === 0) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  if (id === req.userId) return res.status(400).json({ error: "Cannot delete yourself" });
  const info = db.prepare("DELETE FROM users WHERE id = ?").run(id);
  if (info.changes === 0) return res.status(404).json({ error: "User not found" });
  res.json({ ok: true });
});

app.put("/api/auth/change-password", requireAuth, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 5) {
    return res.status(400).json({ error: "Password must be at least 5 characters" });
  }
  const hash = bcrypt.hashSync(String(password), 10);
  db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(hash, req.userId);
  req.session.mustChangePassword = false;
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (!err) return next();
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "File too large (max 45 MB)" });
    }
    return res.status(400).json({ error: err.message });
  }
  return res.status(400).json({ error: err.message || "Bad request" });
});

app.get("/api/transporters", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM transporters ORDER BY name ASC").all();
  res.json({ transporters: rows });
});

app.post("/api/transporters", requireAdmin, (req, res) => {
  try {
    const { name, details } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO transporters (id, name, details, created_at) VALUES (?, ?, ?, ?)").run(
      id,
      name.trim().toUpperCase(),
      details || "",
      now
    );
    const row = db.prepare("SELECT * FROM transporters WHERE id = ?").get(id);
    res.status(201).json({ transporter: row });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Transporter name already exists" });
    }
    res.status(500).json({ error: "Could not create transporter" });
  }
});

app.put("/api/transporters/:id", requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, details } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    db.prepare("UPDATE transporters SET name = ?, details = ? WHERE id = ?").run(
      name.trim().toUpperCase(),
      details || "",
      id
    );
    const row = db.prepare("SELECT * FROM transporters WHERE id = ?").get(id);
    res.json({ transporter: row });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Transporter name already exists" });
    }
    res.status(500).json({ error: "Could not update transporter" });
  }
});

app.delete("/api/transporters/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare("DELETE FROM transporters WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.get("/api/projects", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT * FROM projects ORDER BY name ASC").all();
  res.json({ projects: rows });
});

app.post("/api/projects", requireAdmin, (req, res) => {
  try {
    const { name, details } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare("INSERT INTO projects (id, name, details, created_at) VALUES (?, ?, ?, ?)").run(
      id,
      name.trim().toUpperCase(),
      details || "",
      now
    );
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    res.status(201).json({ project: row });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Project name already exists" });
    }
    res.status(500).json({ error: "Could not create project" });
  }
});

app.put("/api/projects/:id", requireAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, details } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });
    db.prepare("UPDATE projects SET name = ?, details = ? WHERE id = ?").run(
      name.trim().toUpperCase(),
      details || "",
      id
    );
    const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    res.json({ project: row });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "Project name already exists" });
    }
    res.status(500).json({ error: "Could not update project" });
  }
});

app.delete("/api/projects/:id", requireAdmin, (req, res) => {
  const { id } = req.params;
  db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.use(express.static(PUBLIC));

app.listen(PORT, () => {
  console.log(`GPS Management server at http://127.0.0.1:${PORT}/`);
  console.log(`SQLite: ${DB_PATH}`);
  console.log(`Uploads: ${UPLOAD_ROOT}`);
});
