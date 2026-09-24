import { GAME_DURATION_MS, randomSeed, sanitizeName, type LeaderboardEntry, type MoveRecord } from '@match3/shared';
import { Game } from '../game/Game';
import type { GameView } from '../game/GameView';
import { SocketClient, type ConnectionStatus } from '../net/SocketClient';
import { Store } from './store';

export type Screen = 'loading' | 'menu' | 'playing' | 'gameover';

export type SubmitStatus =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'accepted'; rank: number | null }
  | { kind: 'rejected'; reason: string }
  | { kind: 'offline' };

export interface AppState {
  screen: Screen;
  nickname: string;
  score: number;
  combo: number;
  timeLeft: number;
  fps: number;
  best: number;
  connection: ConnectionStatus;
  online: number;
  leaderboard: LeaderboardEntry[];
  submit: SubmitStatus;
}

const NICK_KEY = 'match3.nickname';
const BEST_KEY = 'match3.best';

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private mode / WebView without storage
  }
}
function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function wsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL as string | undefined;
  if (fromEnv) return fromEnv;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

/** Application layer: connects UI state, the network and the game. */
export class AppController {
  readonly store = new Store<AppState>({
    screen: 'loading',
    nickname: readStorage(NICK_KEY) ?? '',
    score: 0,
    combo: 0,
    timeLeft: GAME_DURATION_MS / 1000,
    fps: 0,
    best: Number(readStorage(BEST_KEY) ?? 0) || 0,
    connection: 'offline',
    online: 0,
    leaderboard: [],
    submit: { kind: 'idle' },
  });

  readonly net = new SocketClient(wsUrl());
  private game: Game | null = null;
  private gameId: string | null = null;

  constructor() {
    this.net.onStatus((connection) => this.store.set({ connection }));
    this.net.onMessage((msg) => {
      switch (msg.type) {
        case 'welcome':
          this.store.set({ online: msg.online, leaderboard: msg.leaderboard });
          break;
        case 'online':
          this.store.set({ online: msg.count });
          break;
        case 'leaderboard':
          this.store.set({ leaderboard: msg.entries });
          break;
      }
    });
    this.net.connect();
  }

  attachView(view: GameView): void {
    this.game?.destroy();
    this.game = new Game(view, {
      onScore: (score, combo) => this.store.set({ score, combo }),
      onTime: (timeLeft) => this.store.set({ timeLeft }),
      onFps: (fps) => this.store.set({ fps }),
      onFinish: (result) => void this.handleFinish(result),
    });
    if (this.store.get().screen === 'loading') this.store.set({ screen: 'menu' });
    if (new URLSearchParams(location.search).has('debug')) {
      // Hook for automated e2e tests: lets a bot find a valid move.
      (window as unknown as Record<string, unknown>).__match3 = { findMove: () => this.game?.findMove() ?? null };
    }
  }

  detachView(): void {
    this.game?.destroy();
    this.game = null;
  }

  setNickname(nickname: string): void {
    this.store.set({ nickname });
    writeStorage(NICK_KEY, nickname);
  }

  async startGame(): Promise<void> {
    if (!this.game) return;
    this.store.set({ screen: 'playing', submit: { kind: 'idle' }, score: 0, combo: 0 });

    // Ask the server for a seed. If there is no connection, play offline with a local seed.
    let seed: number;
    try {
      const res = await this.net.request({ type: 'startGame' }, 'gameStarted', 1500);
      seed = res.seed;
      this.gameId = res.gameId;
    } catch {
      seed = randomSeed();
      this.gameId = null;
    }
    await this.game.start(seed);
  }

  backToMenu(): void {
    this.store.set({ screen: 'menu' });
  }

  private async handleFinish({ score, moves }: { score: number; moves: MoveRecord[] }): Promise<void> {
    const best = Math.max(this.store.get().best, score);
    writeStorage(BEST_KEY, String(best));
    this.store.set({ screen: 'gameover', best });

    if (!this.gameId) {
      this.store.set({ submit: { kind: 'offline' } });
      return;
    }
    this.store.set({ submit: { kind: 'sending' } });
    try {
      const res = await this.net.request(
        { type: 'submitScore', gameId: this.gameId, name: sanitizeName(this.store.get().nickname), moves },
        'scoreResult',
        5000,
      );
      this.store.set({
        submit: res.accepted ? { kind: 'accepted', rank: res.rank } : { kind: 'rejected', reason: res.reason },
      });
    } catch {
      this.store.set({ submit: { kind: 'offline' } });
    } finally {
      this.gameId = null;
    }
  }
}

export const controller = new AppController();
