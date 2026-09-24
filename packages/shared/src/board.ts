import { BOARD_COLS, BOARD_ROWS, GEM_TYPES } from './constants';
import { createRng, type Rng } from './rng';

export interface Pos {
  row: number;
  col: number;
}

export interface Gem {
  /** Stable id: the view maps ids to sprites, so gems can be animated as they move. */
  id: number;
  type: number;
}

export interface ClearedGem extends Pos {
  id: number;
  type: number;
}

export interface FallMove {
  id: number;
  col: number;
  fromRow: number;
  toRow: number;
}

export interface Spawn extends Pos {
  id: number;
  type: number;
  /** Negative row above the board where the gem starts falling from. */
  fromRow: number;
}

export interface CascadeStep {
  /** 1 for the direct match, 2+ for chain reactions. */
  multiplier: number;
  cleared: ClearedGem[];
  /** Lengths of every matched line (3, 4, 5...). */
  groups: number[];
  points: number;
  fall: FallMove[];
  spawn: Spawn[];
}

export interface GemPlacement extends Pos {
  id: number;
}

export interface SwapResult {
  valid: boolean;
  steps: CascadeStep[];
  points: number;
  /** Set when the board had no moves left and was reshuffled. */
  shuffle: GemPlacement[] | null;
}

export interface BoardOptions {
  seed: number;
  rows?: number;
  cols?: number;
  types?: number;
}

export function scoreForGroup(length: number): number {
  if (length <= 3) return 30;
  if (length === 4) return 60;
  return 100 + (length - 5) * 40;
}

/**
 * Pure game logic, no rendering. It is shared by the PixiJS client and the Node.js server
 * and covered by unit tests.
 */
export class Board {
  readonly rows: number;
  readonly cols: number;
  readonly types: number;

  private grid: Gem[][] = [];
  private nextId = 1;
  private readonly rng: Rng;

  constructor(options: BoardOptions) {
    this.rows = options.rows ?? BOARD_ROWS;
    this.cols = options.cols ?? BOARD_COLS;
    this.types = options.types ?? GEM_TYPES;
    this.rng = createRng(options.seed);
    this.generate();
  }

  // ---------- public API ----------

  get(pos: Pos): Gem {
    return this.grid[pos.row][pos.col];
  }

  /** Deep copy for rendering / debugging. */
  snapshot(): Gem[][] {
    return this.grid.map((row) => row.map((gem) => ({ ...gem })));
  }

  inBounds(pos: Pos): boolean {
    return pos.row >= 0 && pos.row < this.rows && pos.col >= 0 && pos.col < this.cols;
  }

  static isAdjacent(a: Pos, b: Pos): boolean {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
  }

  /**
   * Swaps two gems. If the swap creates no match it is reverted and marked invalid.
   * Otherwise all cascades are resolved and returned as steps for the view to animate.
   */
  trySwap(a: Pos, b: Pos): SwapResult {
    const invalid: SwapResult = { valid: false, steps: [], points: 0, shuffle: null };
    if (!this.inBounds(a) || !this.inBounds(b) || !Board.isAdjacent(a, b)) return invalid;

    this.swapCells(a, b);
    if (!this.hasAnyMatch()) {
      this.swapCells(a, b);
      return invalid;
    }

    const steps = this.resolveCascades();
    const points = steps.reduce((sum, s) => sum + s.points, 0);
    const shuffle = this.findPossibleMove() ? null : this.shuffle();
    return { valid: true, steps, points, shuffle };
  }

  /** Returns a swap that makes a match (used for hints and deadlock detection). */
  findPossibleMove(): [Pos, Pos] | null {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const a = { row, col };
        const neighbours = [
          { row, col: col + 1 },
          { row: row + 1, col },
        ];
        for (const b of neighbours) {
          if (!this.inBounds(b)) continue;
          this.swapCells(a, b);
          const ok = this.hasMatchAt(a) || this.hasMatchAt(b);
          this.swapCells(a, b);
          if (ok) return [a, b];
        }
      }
    }
    return null;
  }

  // ---------- internals ----------

  private randomType(): number {
    return Math.floor(this.rng() * this.types);
  }

  private generate(): void {
    do {
      this.grid = [];
      for (let row = 0; row < this.rows; row++) {
        const line: Gem[] = [];
        this.grid.push(line);
        for (let col = 0; col < this.cols; col++) {
          let type: number;
          do {
            type = this.randomType();
          } while (this.wouldMatch(row, col, type));
          line.push({ id: this.nextId++, type });
        }
      }
    } while (!this.findPossibleMove());
  }

  /** During generation, checks whether placing `type` at (row, col) completes a line to the left or above. */
  private wouldMatch(row: number, col: number, type: number): boolean {
    const g = this.grid;
    const left = col >= 2 && g[row][col - 1].type === type && g[row][col - 2].type === type;
    const up = row >= 2 && g[row - 1][col].type === type && g[row - 2][col].type === type;
    return left || up;
  }

  private swapCells(a: Pos, b: Pos): void {
    const tmp = this.grid[a.row][a.col];
    this.grid[a.row][a.col] = this.grid[b.row][b.col];
    this.grid[b.row][b.col] = tmp;
  }

  private hasMatchAt(pos: Pos): boolean {
    const type = this.grid[pos.row][pos.col].type;
    const count = (dr: number, dc: number) => {
      let n = 0;
      let r = pos.row + dr;
      let c = pos.col + dc;
      while (this.inBounds({ row: r, col: c }) && this.grid[r][c].type === type) {
        n++;
        r += dr;
        c += dc;
      }
      return n;
    };
    return count(0, -1) + count(0, 1) >= 2 || count(-1, 0) + count(1, 0) >= 2;
  }

  private hasAnyMatch(): boolean {
    return this.findMatches().groups.length > 0;
  }

  /** Finds all horizontal and vertical lines of 3+ gems of the same type. */
  findMatches(): { marked: boolean[][]; groups: number[] } {
    const marked = this.grid.map((row) => row.map(() => false));
    const groups: number[] = [];

    const scan = (lines: number, length: number, at: (line: number, i: number) => Pos) => {
      for (let line = 0; line < lines; line++) {
        let i = 0;
        while (i < length) {
          const start = at(line, i);
          const type = this.grid[start.row][start.col].type;
          let run = 1;
          while (i + run < length) {
            const p = at(line, i + run);
            if (this.grid[p.row][p.col].type !== type) break;
            run++;
          }
          if (run >= 3) {
            groups.push(run);
            for (let k = 0; k < run; k++) {
              const p = at(line, i + k);
              marked[p.row][p.col] = true;
            }
          }
          i += run;
        }
      }
    };

    scan(this.rows, this.cols, (row, col) => ({ row, col }));
    scan(this.cols, this.rows, (col, row) => ({ row, col }));
    return { marked, groups };
  }

  private resolveCascades(): CascadeStep[] {
    const steps: CascadeStep[] = [];
    for (let multiplier = 1; ; multiplier++) {
      const { marked, groups } = this.findMatches();
      if (groups.length === 0) break;

      const cleared: ClearedGem[] = [];
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          if (marked[row][col]) {
            const gem = this.grid[row][col];
            cleared.push({ id: gem.id, type: gem.type, row, col });
          }
        }
      }

      const points = groups.reduce((sum, len) => sum + scoreForGroup(len), 0) * multiplier;
      const { fall, spawn } = this.collapse(marked);
      steps.push({ multiplier, cleared, groups, points, fall, spawn });
    }
    return steps;
  }

  /** Removes marked gems, lets the rest fall down and spawns new gems from above. */
  private collapse(marked: boolean[][]): { fall: FallMove[]; spawn: Spawn[] } {
    const fall: FallMove[] = [];
    const spawn: Spawn[] = [];

    for (let col = 0; col < this.cols; col++) {
      let write = this.rows - 1;
      for (let row = this.rows - 1; row >= 0; row--) {
        if (marked[row][col]) continue;
        const gem = this.grid[row][col];
        if (row !== write) {
          this.grid[write][col] = gem;
          fall.push({ id: gem.id, col, fromRow: row, toRow: write });
        }
        write--;
      }
      const empty = write + 1;
      for (let row = write; row >= 0; row--) {
        const gem: Gem = { id: this.nextId++, type: this.randomType() };
        this.grid[row][col] = gem;
        spawn.push({ id: gem.id, type: gem.type, row, col, fromRow: row - empty });
      }
    }
    return { fall, spawn };
  }

  /** Shuffles the gems until there are no ready matches and at least one move exists. */
  private shuffle(): GemPlacement[] {
    const gems = this.grid.flat();
    for (let attempt = 0; attempt < 100; attempt++) {
      for (let i = gems.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [gems[i], gems[j]] = [gems[j], gems[i]];
      }
      for (let i = 0; i < gems.length; i++) {
        this.grid[Math.floor(i / this.cols)][i % this.cols] = gems[i];
      }
      if (!this.hasAnyMatch() && this.findPossibleMove()) break;
    }
    // Very unlikely fallback: generate a completely new board with fresh ids.
    if (this.hasAnyMatch() || !this.findPossibleMove()) this.generate();

    const placements: GemPlacement[] = [];
    this.grid.forEach((line, row) => line.forEach((gem, col) => placements.push({ id: gem.id, row, col })));
    return placements;
  }
}
