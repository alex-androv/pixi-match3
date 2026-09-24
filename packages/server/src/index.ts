import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import {
  GAME_DURATION_MS,
  parseClientMessage,
  randomSeed,
  replayGame,
  sanitizeName,
  type ClientMessage,
  type ServerMessage,
} from '@match3/shared';
import { Leaderboard } from './leaderboard';
import { createStaticHandler } from './static';

const PORT = Number(process.env.PORT ?? 8787);
const HEARTBEAT_MS = 30_000;
const SESSION_TTL_MS = 10 * 60_000;
const SUBMIT_COOLDOWN_MS = 3_000;

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, '..');
const leaderboard = new Leaderboard(resolve(pkgRoot, 'data/leaderboard.json'));
const serveStatic = createStaticHandler(resolve(pkgRoot, '../client/dist'));

interface GameSession {
  seed: number;
  startedAt: number;
}

interface Client {
  ws: WebSocket;
  alive: boolean;
  sessions: Map<string, GameSession>;
  lastSubmitAt: number;
}

const clients = new Set<Client>();

function send(client: Client, msg: ServerMessage): void {
  if (client.ws.readyState === WebSocket.OPEN) client.ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMessage): void {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
}

function handleMessage(client: Client, msg: ClientMessage): void {
  switch (msg.type) {
    case 'ping':
      send(client, { type: 'pong' });
      return;

    case 'startGame': {
      // The server picks the seed, so a client cannot choose a "lucky" board.
      const gameId = randomUUID();
      const seed = randomSeed();
      client.sessions.set(gameId, { seed, startedAt: Date.now() });
      if (client.sessions.size > 5) client.sessions.delete(client.sessions.keys().next().value!);
      send(client, { type: 'gameStarted', reqId: msg.reqId, gameId, seed });
      return;
    }

    case 'submitScore': {
      const reject = (reason: string) =>
        send(client, { type: 'scoreResult', reqId: msg.reqId, accepted: false, reason });

      const now = Date.now();
      if (now - client.lastSubmitAt < SUBMIT_COOLDOWN_MS) return reject('too many requests');
      client.lastSubmitAt = now;

      const session = client.sessions.get(msg.gameId);
      if (!session) return reject('unknown or expired game');
      client.sessions.delete(msg.gameId); // one submit per game

      // A move cannot happen later than the real time that has passed since the game started.
      const lastMoveT = msg.moves.at(-1)?.t ?? 0;
      if (lastMoveT > now - session.startedAt + 2_000) return reject('timing mismatch');
      if (now - session.startedAt > GAME_DURATION_MS + SESSION_TTL_MS) return reject('game expired');

      const result = replayGame(session.seed, msg.moves);
      if (result.error) return reject(result.error);

      const name = sanitizeName(msg.name);
      const rank = result.score > 0 ? leaderboard.add({ name, score: result.score, at: now }) : null;
      send(client, { type: 'scoreResult', reqId: msg.reqId, accepted: true, score: result.score, rank });
      if (rank !== null) broadcast({ type: 'leaderboard', entries: leaderboard.top() });
      console.log(`[score] ${name}: ${result.score} (${result.validMoves} moves) rank=${rank ?? '-'}`);
      return;
    }
  }
}

async function main(): Promise<void> {
  await leaderboard.load();

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true, online: clients.size }));
      return;
    }
    void serveStatic(req, res);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 64 * 1024 });

  wss.on('connection', (ws) => {
    const client: Client = { ws, alive: true, sessions: new Map(), lastSubmitAt: 0 };
    clients.add(client);

    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data) => {
      const msg = parseClientMessage(data.toString());
      if (!msg) return send(client, { type: 'error', message: 'bad message' });
      handleMessage(client, msg);
    });
    ws.on('close', () => {
      clients.delete(client);
      broadcast({ type: 'online', count: clients.size });
    });
    ws.on('error', (err) => console.warn('[ws] client error', err.message));

    send(client, { type: 'welcome', online: clients.size, leaderboard: leaderboard.top() });
    broadcast({ type: 'online', count: clients.size });
  });

  // Heartbeat: drop "dead" connections (a phone lost network, a tab was killed, ...).
  const heartbeat = setInterval(() => {
    for (const c of clients) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
  }, HEARTBEAT_MS);

  const shutdown = () => {
    clearInterval(heartbeat);
    for (const c of clients) c.ws.close(1001, 'server shutdown');
    http.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  http.listen(PORT, () => console.log(`[server] http://localhost:${PORT}  (ws: /ws)`));
}

void main();
