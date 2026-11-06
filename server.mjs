import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent
} from "tiktok-live-connector";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const USERNAME = (process.env.TIKTOK_USERNAME || "voxiralive").replace(/^@/, "");

const TEAM_CODES = {
  GS: "gs",
  FB: "fb",
  BJK: "bjk",
  TS: "ts",
  AMED: "amed"
};

const users = new Map();
const streaks = new Map();
let connected = false;
let connecting = false;
let lastError = "";
let lastEvent = null;

const conn = new TikTokLiveConnection(USERNAME, {
  processInitialData: true
});

app.use(express.static(process.cwd()));
app.get("/", (req, res) => res.sendFile("index.html", { root: process.cwd() }));
app.get("/health", (req, res) => res.json({
  running: true,
  connected,
  connecting,
  username: USERNAME,
  players: users.size,
  lastError,
  lastEvent
}));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`VOXIRA ARENA running on port ${PORT}`);
});
const wss = new WebSocketServer({ server });

function broadcast(event) {
  const message = JSON.stringify(event);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}

function sendStatus() {
  broadcast({ type: "status", connected, connecting, username: USERNAME, lastError });
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "status", connected, connecting, username: USERNAME, lastError }));
  ws.send(JSON.stringify({ type: "hello", teams: Object.fromEntries(users) }));
});

function getId(data) {
  return String(
    data.user?.userId || data.user?.id || data.user?.uniqueId ||
    data.userId || data.uniqueId || ""
  );
}

function getName(data) {
  return String(
    data.user?.nickname || data.user?.displayId ||
    data.nickname || data.uniqueId || "Izleyici"
  ).slice(0, 30);
}

conn.on(WebcastEvent.CHAT, (data) => {
  const message = String(data.comment || data.content || "")
    .trim()
    .toLocaleUpperCase("tr-TR");
  const team = TEAM_CODES[message];
  if (!team) return;

  const id = getId(data);
  if (!id) {
    console.warn("Team comment received without user ID");
    return;
  }

  const name = getName(data);
  if (users.get(id)?.team === team) return;

  users.set(id, { team, name });
  const event = { type: "join", id, name, team };
  lastEvent = event;
  broadcast(event);
  console.log(`${name} joined ${team}`);
});

conn.on(WebcastEvent.GIFT, (data) => {
  const id = getId(data);
  const player = users.get(id);
  if (!player) {
    console.log("Gift from viewer without a selected team");
    return;
  }

  const gift = String(
    data.giftDetails?.giftName || data.extendedGiftInfo?.name ||
    data.giftName || "Hediye"
  );
  const giftId = String(data.giftId || gift);
  const key = `${id}:${giftId}`;
  const count = Math.max(1, Number(data.repeatCount || 1));
  const isStreak = Number(data.giftType) === 1;
  let quantity = count;

  if (isStreak) {
    const previous = streaks.get(key) || 0;
    quantity = Math.max(0, count - previous);
    streaks.set(key, count);
    if (data.repeatEnd) streaks.delete(key);
  }
  if (quantity <= 0) return;
  quantity = Math.min(quantity, 100);

  const rose = /rose|gül|gul/i.test(gift);
  const lion = /lion|aslan/i.test(gift);
  const soldiersPerGift = lion ? 60 : rose ? 5 : 15;
  const event = {
    type: "gift", team: player.team, name: player.name, gift,
    qty: quantity, soldiers: quantity * soldiersPerGift, boss: lion
  };
  lastEvent = event;
  broadcast(event);
  console.log(`${player.name} sent ${gift} x${quantity}`);
});

conn.on(WebcastEvent.LIKE, (data) => {
  const player = users.get(getId(data));
  if (!player) return;
  broadcast({
    type: "like", team: player.team, name: player.name,
    count: Math.min(50, Math.max(1, Number(data.likeCount || 1)))
  });
});

conn.on(ControlEvent.ERROR, (error) => {
  lastError = String(error?.message || error?.info || error).slice(0, 250);
  console.error("TikTok error:", lastError);
  sendStatus();
});

conn.on(ControlEvent.DISCONNECTED, () => {
  connected = false;
  console.log("TikTok disconnected");
  sendStatus();
});

async function connectLoop() {
  while (true) {
    if (!connected && !connecting) {
      connecting = true;
      sendStatus();
      try {
        console.log(`Connecting to @${USERNAME}`);
        await conn.connect();
        connected = true;
        lastError = "";
        console.log("TikTok LIVE connected!");
      } catch (error) {
        connected = false;
        lastError = String(error?.message || error).slice(0, 250);
        console.error("Connection failed:", lastError);
      } finally {
        connecting = false;
        sendStatus();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 15000));
  }
}

connectLoop();
