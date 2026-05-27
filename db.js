"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const IMAGES_DIR = path.join(DATA_DIR, "images");

const USE_PG = !!process.env.DATABASE_URL;

const EXT_BY_MIME = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MIME_BY_EXT = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

let state = null;
let pool = null;

// async write debounce (shared by both backends)
let saveTimer = null;
let dirty = false;
let saving = false;

function defaultState() {
  const now = Date.now();
  const adminHash = bcrypt.hashSync("admin123", 10);
  const bidderHash = bcrypt.hashSync("bidder123", 10);
  return {
    nextUserId: 3,
    nextItemId: 4,
    users: [
      {
        id: 1,
        email: "admin@auction.local",
        name: "Site Admin",
        passwordHash: adminHash,
        role: "admin",
        createdAt: now,
      },
      {
        id: 2,
        email: "bidder@auction.local",
        name: "Sample Bidder",
        passwordHash: bidderHash,
        role: "bidder",
        createdAt: now,
      },
    ],
    items: [
      {
        id: 1,
        title: "Vintage Mechanical Watch",
        description:
          "1960s hand-wound chronograph in restored condition. Stainless steel case, leather strap.",
        imageUrl: "",
        basePrice: 500,
        status: "draft", // draft | live | closed
        endsAt: null, // epoch ms when the live auction closes
        bids: [], // { userId, userName, amount, at }
      },
      {
        id: 2,
        title: "Abstract Oil Painting",
        description:
          "Original 90x120cm canvas by a regional artist. Signed, framed, certificate of authenticity included.",
        imageUrl: "",
        basePrice: 1200,
        status: "draft",
        endsAt: null,
        bids: [],
      },
      {
        id: 3,
        title: "First-Edition Rare Book",
        description:
          "Collectible first printing, excellent dust jacket, stored in archival sleeve.",
        imageUrl: "",
        basePrice: 300,
        status: "draft",
        endsAt: null,
        bids: [],
      },
    ],
    content: {
      clauses:
        "1. Eligibility — Bidding is restricted to pre-registered account holders only.\n" +
        "2. Binding Bids — Every bid placed is a legally binding offer to purchase at the stated amount.\n" +
        "3. Reserve / Base Price — No bid below the item's base price will be accepted.\n" +
        "4. Auction Timing — Each lot is open only while the administrator keeps its timer running; bids after closing are rejected.\n" +
        "5. Winning Bid — The highest valid bid at the moment of closing wins the lot.\n" +
        "6. Payment — The winning bidder must settle payment within 7 days of close.\n" +
        "7. Admin Authority — The administrator may pause, extend, or close any lot, and may void bids placed in error.\n" +
        "8. No Retraction — Bids cannot be retracted once submitted.",
      faq:
        "Q: How do I get an account?\nA: Accounts are created by the site administrator. Public self-registration is disabled.\n\n" +
        "Q: How do I place a bid?\nA: Log in, open a live lot from the catalog, and enter an amount higher than the current highest bid (or at least the base price for the first bid).\n\n" +
        "Q: What happens when the timer hits zero?\nA: The lot closes automatically and no further bids are accepted. The highest bid at that instant wins.\n\n" +
        "Q: Can the admin change the time?\nA: Yes. The administrator controls each lot's timer and may start, pause, extend, or close it.\n\n" +
        "Q: Is my bid final?\nA: Yes. All bids are binding and cannot be retracted.",
    },
  };
}

// Load existing state (or seed defaults) from the active backend. Call once at startup.
async function init() {
  if (USE_PG) {
    const { Pool } = require("pg");
    const url = process.env.DATABASE_URL;
    const isLocal = /@(localhost|127\.0\.0\.1)/.test(url);
    pool = new Pool({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
    await pool.query(
      "CREATE TABLE IF NOT EXISTS app_state (id integer PRIMARY KEY, data jsonb NOT NULL)"
    );
    await pool.query(
      "CREATE TABLE IF NOT EXISTS images (id serial PRIMARY KEY, mime text NOT NULL, data bytea NOT NULL, created_at timestamptz DEFAULT now())"
    );
    const res = await pool.query("SELECT data FROM app_state WHERE id = 1");
    if (res.rows.length) {
      state = res.rows[0].data; // pg parses jsonb into a JS object
    } else {
      state = defaultState();
      await pool.query("INSERT INTO app_state (id, data) VALUES (1, $1)", [
        JSON.stringify(state),
      ]);
    }
    console.log("Storage: PostgreSQL (persistent)");
  } else {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } else {
      state = defaultState();
      fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
    }
    console.log("Storage: local file (data/db.json)");
  }
}

// Mark the in-memory state dirty; it is flushed to the backend asynchronously (debounced).
function save() {
  dirty = true;
  if (!saveTimer) saveTimer = setTimeout(flush, 300);
}

async function flush() {
  saveTimer = null;
  if (saving) {
    saveTimer = setTimeout(flush, 300);
    return;
  }
  if (!dirty) return;
  saving = true;
  dirty = false;
  try {
    if (USE_PG) {
      await pool.query(
        "INSERT INTO app_state (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
        [JSON.stringify(state)]
      );
    } else {
      fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
    }
  } catch (err) {
    console.error("Failed to persist state:", err.message);
    dirty = true; // keep dirty so the next flush retries
  } finally {
    saving = false;
    if (dirty && !saveTimer) saveTimer = setTimeout(flush, 300);
  }
}

function get() {
  return state;
}

// ---- image blob storage (kept OUT of the state document to avoid bloating every save) ----

// Store an uploaded image; returns an opaque string id for use in /api/images/:id
async function saveImage(buffer, mime) {
  const ext = EXT_BY_MIME[mime];
  if (!ext) throw new Error("Unsupported image type");
  if (USE_PG) {
    const r = await pool.query(
      "INSERT INTO images (mime, data) VALUES ($1, $2) RETURNING id",
      [mime, buffer]
    );
    return String(r.rows[0].id);
  }
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const id = crypto.randomBytes(10).toString("hex") + "." + ext;
  fs.writeFileSync(path.join(IMAGES_DIR, id), buffer);
  return id;
}

// Fetch an image by id; returns { mime, data } or null
async function getImage(id) {
  if (USE_PG) {
    if (!/^\d+$/.test(String(id))) return null;
    const r = await pool.query("SELECT mime, data FROM images WHERE id = $1", [Number(id)]);
    if (!r.rows.length) return null;
    return { mime: r.rows[0].mime, data: r.rows[0].data };
  }
  const safe = path.basename(String(id)); // prevent path traversal
  const file = path.join(IMAGES_DIR, safe);
  if (!file.startsWith(IMAGES_DIR) || !fs.existsSync(file)) return null;
  const ext = safe.split(".").pop().toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  return { mime, data: fs.readFileSync(file) };
}

module.exports = { init, get, save, saveImage, getImage, DB_FILE };
