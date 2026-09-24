import { MAX_MOVES_PER_GAME, MAX_NAME_LENGTH } from './constants';

/**
 * WebSocket protocol shared by the client and the server.
 * Messages are discriminated unions: TypeScript narrows the type by the `type` field.
 */

export interface MoveRecord {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
  /** Game time of the move in ms since the round started. */
  t: number;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  at: number;
}

// ----- client -> server -----
export type ClientMessage =
  | { type: 'ping' }
  | { type: 'startGame'; reqId: number }
  | { type: 'submitScore'; reqId: number; gameId: string; name: string; moves: MoveRecord[] };

// ----- server -> client -----
export type ServerMessage =
  | { type: 'pong' }
  | { type: 'welcome'; online: number; leaderboard: LeaderboardEntry[] }
  | { type: 'online'; count: number }
  | { type: 'leaderboard'; entries: LeaderboardEntry[] }
  | { type: 'gameStarted'; reqId: number; gameId: string; seed: number }
  | { type: 'scoreResult'; reqId: number; accepted: true; score: number; rank: number | null }
  | { type: 'scoreResult'; reqId: number; accepted: false; reason: string }
  | { type: 'error'; reqId?: number; message: string };

export type ServerMessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

// ----- validation (input from the network is untrusted) -----

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

function isMove(v: unknown): v is MoveRecord {
  return (
    isObj(v) &&
    isInt(v.r1) && isInt(v.c1) && isInt(v.r2) && isInt(v.c2) &&
    isInt(v.t) && v.t >= 0
  );
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(data) || typeof data.type !== 'string') return null;

  switch (data.type) {
    case 'ping':
      return { type: 'ping' };
    case 'startGame':
      return isInt(data.reqId) ? { type: 'startGame', reqId: data.reqId } : null;
    case 'submitScore': {
      const { reqId, gameId, name, moves } = data;
      if (!isInt(reqId) || typeof gameId !== 'string' || typeof name !== 'string') return null;
      if (!Array.isArray(moves) || moves.length > MAX_MOVES_PER_GAME || !moves.every(isMove)) return null;
      return { type: 'submitScore', reqId, gameId, name, moves };
    }
    default:
      return null;
  }
}

export function parseServerMessage(raw: string): ServerMessage | null {
  try {
    const data: unknown = JSON.parse(raw);
    return isObj(data) && typeof data.type === 'string' ? (data as ServerMessage) : null;
  } catch {
    return null;
  }
}

export function sanitizeName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME_LENGTH);
  return clean || 'Player';
}
