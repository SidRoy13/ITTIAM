"use strict";

const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

let state = null;
let writeQueued = false;

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

function load() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    } else {
      state = defaultState();
      save();
    }
  } catch (err) {
    console.error("Failed to load db, starting fresh:", err.message);
    state = defaultState();
    save();
  }
}

function save() {
  if (writeQueued) return;
  writeQueued = true;
  setImmediate(() => {
    writeQueued = false;
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error("Failed to save db:", err.message);
    }
  });
}

function get() {
  if (!state) load();
  return state;
}

module.exports = { get, save, load, DB_FILE };
