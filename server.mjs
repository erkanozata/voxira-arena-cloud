
import express from 'express';
import { WebSocketServer } from 'ws';
import {
  TikTokLiveConnection,
  WebcastEvent,
  ControlEvent
} from 'tiktok-live-connector';

const app = express();
const username = (process.env.TIKTOK_USERNAME || 'voxiralive')
  .replace(/^@/, '');

const port = Number(process.env.PORT || 3000);

app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile('index.html', {
    root: process.cwd() + '/public'
  });
});

app.get('/health', (req, res) => {
  res.json({
    running: true,
    connected,
    username,
    lastError
  });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log('VOXIRA ARENA server started on port ' + port);
});

const wss = new WebSocketServer({ server });

const users = new Map();
const streaks = new Map();

let connected = false;
let lastError = '';

function emit(data) {
  const message = JSON.stringify(data);

  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

function status() {
  emit({
    type: 'status',
    connected,
    username,
    lastError
  });
}

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'status',
    connected,
    username,
    lastError
  }));

  ws.send(JSON.stringify({
    type: 'hello',
    teams: Object.fromEntries(users)
  }));
});

function uid(data) {
  return String(
    data.user?.id ||
    data.user?.userId ||
    data.user?.uniqueId ||
    data.uniqueId ||
    'unknown'
  );
}

function nick(data) {
  return String(
    data.user?.displayId ||
    data.user?.nickname ||
    data.uniqueId ||
    'Izleyici'
  ).slice(0, 30);
}

const conn = new TikTokLiveConnection(username, {
  processInitialData: true
});

conn.on(WebcastEvent.CHAT, (data) => {
  const msg = String(
    data.content || data.comment || ''
  ).trim().toLocaleLowerCase('tr-TR');

  let team = null;

  if (msg === 'mavi' || msg === '1') {
    team = 'blue';
  }

  if (
    msg === 'kırmızı' ||
    msg === 'kirmizi' ||
    msg === '2'
  ) {
    team = 'red';
  }

  if (!team) return;

  const id = uid(data);
  const name = nick(data);

  users.set(id, { team, name });

  emit({
    type: 'join',
    id,
    team,
    name
  });

  console.log(name + ' joined ' + team);
});

conn.on(WebcastEvent.GIFT, (data) => {
  const id = uid(data);
  const user = users.get(id);

  if (!user) return;

  const gift = String(
    data.giftDetails?.giftName ||
    data.extendedGiftInfo?.name ||
    data.giftName ||
    'Hediye'
  );

  const key = id + ':' + String(data.giftId || gift);

  const count = Math.max(
    1,
    Number(data.repeatCount || 1)
  );

  const isStreak = Number(data.giftType) === 1;

  let qty = count;

  if (isStreak) {
    const previous = streaks.get(key) || 0;

    qty = Math.max(0, count - previous);
    streaks.set(key, count);

    if (data.repeatEnd) {
      streaks.delete(key);
    }
  }

  if (!qty) return;

  qty = Math.min(qty, 100);

  const rose = /rose|gül|gul/i.test(gift);
  const lion = /lion|aslan/i.test(gift);

  const soldiersPerGift = lion ? 60 : rose ? 5 : 15;

  emit({
    type: 'gift',
    team: user.team,
    name: user.name,
    gift,
    qty,
    soldiers: qty * soldiersPerGift,
    boss: lion
  });

  console.log(
    user.name + ' sent ' + gift + ' x' + qty
  );
});

conn.on(WebcastEvent.LIKE, (data) => {
  const user = users.get(uid(data));

  if (!user) return;

  emit({
    type: 'like',
    team: user.team,
    name: user.name,
    count: Math.min(
      50,
      Math.max(1, Number(data.likeCount || 1))
    )
  });
});

conn.on(ControlEvent.ERROR, (error) => {
  lastError = String(
    error?.info ||
    error?.message ||
    error
  ).slice(0, 200);

  console.error('TikTok error:', lastError);
  status();
});

conn.on(ControlEvent.DISCONNECTED, () => {
  connected = false;
  console.log('TikTok disconnected');
  status();
});

async function connectLoop() {
  while (true) {
    if (!connected) {
      try {
        console.log('Connecting to @' + username);

        await conn.connect();

        connected = true;
        lastError = '';

        console.log('TikTok LIVE connected');
        status();
      } catch (error) {
        connected = false;

        lastError = String(
          error?.message || error
        ).slice(0, 200);

        console.error('Connection failed:', lastError);
        status();
      }
    }

    await new Promise(resolve => {
      setTimeout(resolve, 15000);
    });
  }
}

connectLoop();
    
