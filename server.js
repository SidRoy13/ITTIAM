"use strict";

const path = require("path");
const http = require("http");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const XLSX = require("xlsx");
const { Server } = require("socket.io");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024 },
});

const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_MIMES.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPEG, PNG, WebP or GIF images are allowed"));
  },
});

const db = require("./db");

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax", maxAge: 1000 * 60 * 60 * 8 },
  })
);

// ---------- helpers ----------
function findUser(predicate) {
  return db.get().users.find(predicate);
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt };
}

function genTempPassword() {
  // 10-char readable alphanumeric, no ambiguous chars
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(10);
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[bytes[i] % chars.length];
  return out;
}

// match a row's column to a logical field using flexible header names
function pick(row, names) {
  const keys = Object.keys(row);
  for (const n of names) {
    const k = keys.find((key) => key.toLowerCase().replace(/[\s_]+/g, "") === n);
    if (k !== undefined && String(row[k]).trim() !== "") return String(row[k]).trim();
  }
  return "";
}

function highestBid(item) {
  if (!item.bids.length) return null;
  return item.bids.reduce((a, b) => (b.amount > a.amount ? b : a));
}

// Resolve the winning/leading bidder for a lot, including email (admin use only).
function winnerOf(item) {
  const top = highestBid(item);
  if (!top) return null;
  const user = findUser((u) => u.id === top.userId);
  return { name: top.userName, email: user ? user.email : null, amount: top.amount, at: top.at };
}

function publicItem(item, { includeDraft } = {}) {
  const top = highestBid(item);
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    imageUrl: item.imageUrl,
    basePrice: item.basePrice,
    status: item.status,
    endsAt: item.endsAt,
    remainingMs: item.remainingMs || null,
    currentBid: top ? top.amount : null,
    currentBidder: top ? top.userName : null,
    bidCount: item.bids.length,
    minNextBid: top ? top.amount + 1 : item.basePrice,
    bids: item.bids
      .slice()
      .sort((a, b) => b.at - a.at)
      .slice(0, 20)
      .map((b) => ({ userName: b.userName, amount: b.amount, at: b.at })),
    isDraft: item.status === "draft",
    _hidden: item.status === "draft" && !includeDraft,
  };
}

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const user = findUser((u) => u.id === req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: "Session invalid" });
  }
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== "admin") return res.status(403).json({ error: "Admin only" });
    next();
  });
}

function broadcastItem(item) {
  io.emit("item:update", publicItem(item, { includeDraft: false }));
}

// ---------- auth ----------
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const user = findUser((u) => u.email.toLowerCase() === String(email).toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = findUser((u) => u.id === req.session.userId);
  res.json({ user: user ? publicUser(user) : null });
});

// ---------- public content ----------
app.get("/api/content", (req, res) => {
  res.json(db.get().content);
});

// ---------- catalog ----------
app.get("/api/items", (req, res) => {
  const isAdmin = req.session.userId && findUser((u) => u.id === req.session.userId)?.role === "admin";
  const items = db
    .get()
    .items.map((i) => publicItem(i, { includeDraft: isAdmin }))
    .filter((i) => !i._hidden);
  items.forEach((i) => delete i._hidden);
  res.json({ items });
});

// ---------- bidding ----------
app.post("/api/items/:id/bids", requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const item = db.get().items.find((i) => i.id === id);
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (item.status !== "live") return res.status(409).json({ error: "Bidding is not open for this lot" });
  if (item.endsAt && Date.now() >= item.endsAt) {
    return res.status(409).json({ error: "The timer for this lot has ended" });
  }
  const amount = Number(req.body && req.body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Invalid bid amount" });

  const top = highestBid(item);
  const min = top ? top.amount + 1 : item.basePrice;
  if (amount < min) {
    return res.status(400).json({ error: `Bid must be at least ${min}` });
  }

  item.bids.push({ userId: req.user.id, userName: req.user.name, amount, at: Date.now() });
  db.save();
  broadcastItem(item);
  res.json({ item: publicItem(item) });
});

// ---------- admin: users ----------
app.get("/api/admin/users", requireAdmin, (req, res) => {
  res.json({ users: db.get().users.map(publicUser) });
});

app.post("/api/admin/users", requireAdmin, (req, res) => {
  const { email, name, password, role } = req.body || {};
  if (!email || !password || !name) {
    return res.status(400).json({ error: "Name, email and password are required" });
  }
  if (findUser((u) => u.email.toLowerCase() === String(email).toLowerCase())) {
    return res.status(409).json({ error: "A user with that email already exists" });
  }
  const data = db.get();
  const user = {
    id: data.nextUserId++,
    email: String(email).trim(),
    name: String(name).trim(),
    passwordHash: bcrypt.hashSync(String(password), 10),
    role: role === "admin" ? "admin" : "bidder",
    createdAt: Date.now(),
  };
  data.users.push(user);
  db.save();
  res.json({ user: publicUser(user) });
});

app.post("/api/admin/users/bulk", requireAdmin, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || "Upload failed" });
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let rows;
    try {
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("The workbook has no sheets");
      rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    } catch (e) {
      return res.status(400).json({ error: "Could not read the Excel file: " + e.message });
    }
    if (!rows.length) return res.status(400).json({ error: "The sheet has no data rows" });

    const data = db.get();
    const results = [];
    const seenInFile = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const name = pick(row, ["name", "fullname", "username"]);
      const email = pick(row, ["email", "emailid", "emailaddress", "id", "userid", "loginid"]);
      const roleRaw = pick(row, ["role"]).toLowerCase();
      const role = roleRaw === "admin" ? "admin" : "bidder";
      const line = i + 2; // header is row 1

      if (!name || !email) {
        results.push({ line, name, email, status: "skipped", reason: "Missing name or email" });
        continue;
      }
      const key = email.toLowerCase();
      if (seenInFile.has(key)) {
        results.push({ line, name, email, status: "skipped", reason: "Duplicate in file" });
        continue;
      }
      seenInFile.add(key);
      if (findUser((u) => u.email.toLowerCase() === key)) {
        results.push({ line, name, email, status: "skipped", reason: "Already registered" });
        continue;
      }

      const password = genTempPassword();
      data.users.push({
        id: data.nextUserId++,
        email,
        name,
        passwordHash: bcrypt.hashSync(password, 10),
        role,
        createdAt: Date.now(),
      });
      results.push({ line, name, email, role, status: "created", password });
    }

    db.save();
    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.length - created;
    res.json({ created, skipped, total: results.length, results });
  });
});

// Regenerate temporary passwords for users and return the plaintext once (for CSV export).
// Existing passwords are bcrypt-hashed and cannot be read back, so this RESETS them.
// Body: { scope: "all" | "bidders" } (default "all").
app.post("/api/admin/users/credentials", requireAdmin, (req, res) => {
  const scope = (req.body && req.body.scope) === "bidders" ? "bidders" : "all";
  const data = db.get();
  const out = [];
  for (const u of data.users) {
    if (scope === "bidders" && u.role !== "bidder") continue;
    const password = genTempPassword();
    u.passwordHash = bcrypt.hashSync(password, 10);
    out.push({ name: u.name, email: u.email, role: u.role, password });
  }
  db.save();
  res.json({ count: out.length, users: out });
});

app.delete("/api/admin/users/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "You cannot delete your own account" });
  const data = db.get();
  const idx = data.users.findIndex((u) => u.id === id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  data.users.splice(idx, 1);
  db.save();
  res.json({ ok: true });
});

// ---------- admin: items ----------
// Accepts multipart/form-data (optional "image" file) or plain JSON (optional imageUrl).
app.post("/api/admin/items", requireAdmin, (req, res) => {
  imageUpload.single("image")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || "Image upload failed" });

    const { title, description, basePrice, imageUrl } = req.body || {};
    if (!title || !Number.isFinite(Number(basePrice)) || Number(basePrice) <= 0) {
      return res.status(400).json({ error: "Title and a positive base price are required" });
    }

    let finalImageUrl = String(imageUrl || "").trim();
    if (req.file) {
      try {
        const id = await db.saveImage(req.file.buffer, req.file.mimetype);
        finalImageUrl = "/api/images/" + id;
      } catch (e) {
        return res.status(400).json({ error: "Could not store image: " + e.message });
      }
    }

    const data = db.get();
    const item = {
      id: data.nextItemId++,
      title: String(title).trim(),
      description: String(description || "").trim(),
      imageUrl: finalImageUrl,
      basePrice: Number(basePrice),
      status: "draft",
      endsAt: null,
      bids: [],
    };
    data.items.push(item);
    db.save();
    broadcastItem(item);
    res.json({ item: publicItem(item, { includeDraft: true }) });
  });
});

// ---------- public: serve uploaded images ----------
app.get("/api/images/:id", async (req, res) => {
  try {
    const img = await db.getImage(req.params.id);
    if (!img) return res.status(404).send("Image not found");
    res.set("Content-Type", img.mime);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.send(img.data);
  } catch (e) {
    res.status(500).send("Image error");
  }
});

app.put("/api/admin/items/:id", requireAdmin, (req, res) => {
  const item = db.get().items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Item not found" });
  const { title, description, basePrice, imageUrl } = req.body || {};
  if (title !== undefined) item.title = String(title).trim();
  if (description !== undefined) item.description = String(description).trim();
  if (imageUrl !== undefined) item.imageUrl = String(imageUrl).trim();
  if (basePrice !== undefined && Number.isFinite(Number(basePrice)) && Number(basePrice) > 0) {
    item.basePrice = Number(basePrice);
  }
  db.save();
  broadcastItem(item);
  res.json({ item: publicItem(item, { includeDraft: true }) });
});

app.delete("/api/admin/items/:id", requireAdmin, (req, res) => {
  const data = db.get();
  const idx = data.items.findIndex((i) => i.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Item not found" });
  const [removed] = data.items.splice(idx, 1);
  db.save();
  io.emit("item:remove", { id: removed.id });
  res.json({ ok: true });
});

// ---------- admin: timer control ----------
app.post("/api/admin/items/:id/start", requireAdmin, (req, res) => {
  const item = db.get().items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (item.status === "paused" && item.remainingMs) {
    item.endsAt = Date.now() + item.remainingMs;
    item.remainingMs = null;
  } else {
    const seconds = Number(req.body && req.body.durationSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return res.status(400).json({ error: "A positive duration (seconds) is required" });
    }
    item.endsAt = Date.now() + seconds * 1000;
    item.remainingMs = null;
  }
  item.status = "live";
  db.save();
  broadcastItem(item);
  res.json({ item: publicItem(item) });
});

app.post("/api/admin/items/:id/pause", requireAdmin, (req, res) => {
  const item = db.get().items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Item not found" });
  if (item.status !== "live") return res.status(409).json({ error: "Lot is not live" });
  item.remainingMs = Math.max(0, (item.endsAt || Date.now()) - Date.now());
  item.endsAt = null;
  item.status = "paused";
  db.save();
  broadcastItem(item);
  res.json({ item: publicItem(item) });
});

app.post("/api/admin/items/:id/extend", requireAdmin, (req, res) => {
  const item = db.get().items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Item not found" });
  const seconds = Number(req.body && req.body.seconds);
  if (!Number.isFinite(seconds) || seconds === 0) {
    return res.status(400).json({ error: "Seconds to add/remove is required" });
  }
  if (item.status === "live" && item.endsAt) {
    item.endsAt = Math.max(Date.now() + 1000, item.endsAt + seconds * 1000);
  } else if (item.status === "paused") {
    item.remainingMs = Math.max(0, (item.remainingMs || 0) + seconds * 1000);
  } else {
    return res.status(409).json({ error: "Lot must be live or paused to adjust the timer" });
  }
  db.save();
  broadcastItem(item);
  res.json({ item: publicItem(item) });
});

app.post("/api/admin/items/:id/close", requireAdmin, (req, res) => {
  const item = db.get().items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Item not found" });
  item.status = "closed";
  item.endsAt = null;
  item.remainingMs = null;
  db.save();
  broadcastItem(item);
  res.json({ item: publicItem(item) });
});

// ---------- admin: top-N bidders for a lot ----------
// Returns each unique bidder's highest bid on the lot, sorted high-to-low.
// ?n=10 by default (1..100). Includes the bidder's email (admin only).
app.get("/api/admin/items/:id/top-bidders", requireAdmin, (req, res) => {
  const item = db.get().items.find((i) => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Item not found" });
  const n = Math.max(1, Math.min(100, Number(req.query.n) || 10));

  // each unique userId -> their best bid {userId, userName, amount, at}
  const best = new Map();
  for (const b of item.bids) {
    const cur = best.get(b.userId);
    if (!cur || b.amount > cur.amount) best.set(b.userId, b);
  }
  const users = db.get().users;
  const ranked = [...best.values()]
    .sort((a, b) => b.amount - a.amount || a.at - b.at)
    .slice(0, n)
    .map((b, idx) => {
      const u = users.find((u) => u.id === b.userId);
      return {
        rank: idx + 1,
        name: b.userName,
        email: u ? u.email : null,
        amount: b.amount,
        at: b.at,
      };
    });

  res.json({
    item: { id: item.id, title: item.title, basePrice: item.basePrice, status: item.status },
    bidders: ranked,
  });
});

// ---------- admin: clear bids only (keep lots) ----------
// Wipes every lot's bids and returns it to "draft" (timer reset, ready to start again).
// Lots, users, T&C/FAQ untouched.
app.post("/api/admin/clear-bids", requireAdmin, (req, res) => {
  const data = db.get();
  let lotsAffected = 0;
  let bidsRemoved = 0;
  for (const it of data.items) {
    const dirty = it.bids.length > 0 || it.status !== "draft" || it.endsAt || it.remainingMs;
    if (!dirty) continue;
    bidsRemoved += it.bids.length;
    it.bids = [];
    it.status = "draft";
    it.endsAt = null;
    it.remainingMs = null;
    lotsAffected++;
    broadcastItem(it);
  }
  db.save();
  res.json({ ok: true, lotsAffected, bidsRemoved });
});

// ---------- admin: clean up & start a new auction ----------
// Removes ALL lots and bids and resets the item id counter. Users, Terms & FAQ are kept.
app.post("/api/admin/reset", requireAdmin, (req, res) => {
  const data = db.get();
  const removedIds = data.items.map((i) => i.id);
  data.items = [];
  data.nextItemId = 1;
  db.save();
  removedIds.forEach((id) => io.emit("item:remove", { id }));
  res.json({ ok: true, removed: removedIds.length });
});

// ---------- admin: auction results / winners ----------
app.get("/api/admin/results", requireAdmin, (req, res) => {
  const results = db.get().items.map((it) => {
    const w = winnerOf(it);
    return {
      id: it.id,
      title: it.title,
      status: it.status,
      basePrice: it.basePrice,
      bidCount: it.bids.length,
      winner: it.status === "closed" ? w : null, // final winner
      leading: it.status !== "closed" ? w : null, // in-progress leader
    };
  });
  res.json({ results });
});

// ---------- admin: content (clauses / faq) ----------
app.put("/api/admin/content", requireAdmin, (req, res) => {
  const { clauses, faq } = req.body || {};
  const data = db.get();
  if (typeof clauses === "string") data.content.clauses = clauses;
  if (typeof faq === "string") data.content.faq = faq;
  db.save();
  res.json({ content: data.content });
});

// ---------- static ----------
app.use(express.static(path.join(__dirname, "public")));

// ---------- authoritative timer loop ----------
setInterval(() => {
  const data = db.get();
  if (!data) return;
  const now = Date.now();
  let changed = false;
  for (const item of data.items) {
    if (item.status === "live" && item.endsAt && now >= item.endsAt) {
      item.status = "closed";
      item.endsAt = null;
      item.remainingMs = null;
      changed = true;
      broadcastItem(item);
    }
  }
  if (changed) db.save();
}, 1000);

const HOST = process.env.HOST || "0.0.0.0";
db.init().then(() => {
  server.listen(PORT, HOST, () => {
  console.log(`Auction site listening on ${HOST}:${PORT}`);
  console.log(`  Local:   http://localhost:${PORT}`);
  const nets = require("os").networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`  Network: http://${net.address}:${PORT}  (same Wi-Fi/LAN)`);
      }
    }
  }
  console.log("Seed admin login:  admin@auction.local / admin123");
  console.log("Seed bidder login: bidder@auction.local / bidder123");
  });
}).catch((err) => {
  console.error("Failed to initialise storage:", err);
  process.exit(1);
});
