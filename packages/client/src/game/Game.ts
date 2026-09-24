import { Board, GAME_DURATION_MS, type MoveRecord, type Pos } from '@match3/shared';
import { GameView } from './GameView';

export type GamePhase = 'idle' | 'playing' | 'finished';

export interface GameCallbacks {
  onScore(score: number, combo: number): void;
  /** Called once per second, not every frame, so React does not re-render at 60 FPS. */
  onTime(secondsLeft: number): void;
  onFps(fps: number): void;
  onFinish(result: { score: number; moves: MoveRecord[] }): void;
}

const HINT_DELAY_MS = 5000;

/**
 * Game controller: connects the pure logic (Board) with the view (GameView).
 * Handles the round timer, move recording (for server validation) and hints.
 */
export class Game {
  private board: Board | null = null;
  private phase: GamePhase = 'idle';
  private busy = false;
  private elapsed = 0;
  private idle = 0;
  private score = 0;
  private moves: MoveRecord[] = [];
  private lastSecond = -1;
  private fpsTimer = 0;
  private readonly offTick: () => void;

  constructor(
    private readonly view: GameView,
    private readonly cb: GameCallbacks,
  ) {
    view.onSwap = (a, b) => void this.handleSwap(a, b);
    this.offTick = view.onTick(this.tick);
  }

  get currentPhase(): GamePhase {
    return this.phase;
  }

  async start(seed: number): Promise<void> {
    this.board = new Board({ seed });
    this.phase = 'idle';
    this.busy = true;
    this.view.inputEnabled = false;
    this.elapsed = 0;
    this.idle = 0;
    this.score = 0;
    this.moves = [];
    this.lastSecond = -1;
    this.cb.onScore(0, 0);
    this.cb.onTime(Math.ceil(GAME_DURATION_MS / 1000));

    await this.view.setBoard(this.board.snapshot());

    this.phase = 'playing';
    this.busy = false;
    this.view.inputEnabled = true;
  }

  /** Used by e2e tests (`?debug` in the URL). */
  findMove(): [Pos, Pos] | null {
    return this.board?.findPossibleMove() ?? null;
  }

  destroy(): void {
    this.offTick();
  }

  private readonly tick = (dt: number) => {
    this.fpsTimer += dt;
    if (this.fpsTimer >= 500) {
      this.fpsTimer = 0;
      this.cb.onFps(this.view.fps);
    }
    if (this.phase !== 'playing') return;

    this.elapsed = Math.min(GAME_DURATION_MS, this.elapsed + dt);
    const secondsLeft = Math.ceil((GAME_DURATION_MS - this.elapsed) / 1000);
    if (secondsLeft !== this.lastSecond) {
      this.lastSecond = secondsLeft;
      this.cb.onTime(secondsLeft);
    }

    if (this.elapsed >= GAME_DURATION_MS) {
      this.view.inputEnabled = false;
      if (!this.busy) this.finish(); // otherwise finish after the current cascade ends
      return;
    }

    if (!this.busy && this.board) {
      this.idle += dt;
      if (this.idle > HINT_DELAY_MS) {
        this.idle = -Infinity; // show once until the next move
        const move = this.board.findPossibleMove();
        if (move) this.view.showHint(move);
      }
    }
  };

  private async handleSwap(a: Pos, b: Pos): Promise<void> {
    if (this.phase !== 'playing' || this.busy || !this.board) return;
    if (this.elapsed >= GAME_DURATION_MS) return;
    this.busy = true;
    this.idle = 0;
    this.view.inputEnabled = false;

    const t = Math.floor(this.elapsed);
    const result = this.board.trySwap(a, b);
    if (result.valid) this.moves.push({ r1: a.row, c1: a.col, r2: b.row, c2: b.col, t });

    await this.view.animateSwap(a, b, result.valid);
    for (const step of result.steps) {
      this.score += step.points;
      this.cb.onScore(this.score, step.multiplier);
      await this.view.animateStep(step);
    }
    if (result.shuffle) await this.view.animateShuffle(result.shuffle);
    this.cb.onScore(this.score, 0);

    this.busy = false;
    if (this.elapsed >= GAME_DURATION_MS) this.finish();
    else this.view.inputEnabled = true;
  }

  private finish(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'finished';
    this.view.inputEnabled = false;
    this.view.hideHint();
    this.cb.onFinish({ score: this.score, moves: this.moves });
  }
}
