import { describe, expect, it } from 'vitest';
import { Board, scoreForGroup } from './board';
import { replayGame } from './replay';
import type { MoveRecord } from './protocol';

function playRandomGame(seed: number, count: number): { moves: MoveRecord[]; score: number } {
  const board = new Board({ seed });
  const moves: MoveRecord[] = [];
  let score = 0;
  for (let i = 0; i < count; i++) {
    const move = board.findPossibleMove();
    if (!move) throw new Error('board must always have a move');
    const [a, b] = move;
    const result = board.trySwap(a, b);
    expect(result.valid).toBe(true);
    score += result.points;
    moves.push({ r1: a.row, c1: a.col, r2: b.row, c2: b.col, t: i * 100 });
  }
  return { moves, score };
}

describe('Board', () => {
  it('generates a board without ready matches and with at least one move', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const board = new Board({ seed });
      expect(board.findMatches().groups).toHaveLength(0);
      expect(board.findPossibleMove()).not.toBeNull();
    }
  });

  it('is deterministic for the same seed', () => {
    expect(new Board({ seed: 42 }).snapshot()).toEqual(new Board({ seed: 42 }).snapshot());
    expect(new Board({ seed: 42 }).snapshot()).not.toEqual(new Board({ seed: 43 }).snapshot());
  });

  it('rejects non-adjacent and non-matching swaps and keeps the board unchanged', () => {
    const board = new Board({ seed: 7 });
    const before = board.snapshot();
    expect(board.trySwap({ row: 0, col: 0 }, { row: 2, col: 2 }).valid).toBe(false);
    expect(board.trySwap({ row: 0, col: 0 }, { row: -1, col: 0 }).valid).toBe(false);
    expect(board.snapshot()).toEqual(before);
  });

  it('resolves a valid swap: clears gems, refills the board, leaves no matches', () => {
    const board = new Board({ seed: 3 });
    const [a, b] = board.findPossibleMove()!;
    const result = board.trySwap(a, b);

    expect(result.valid).toBe(true);
    expect(result.steps.length).toBeGreaterThan(0);
    expect(result.steps[0].multiplier).toBe(1);
    for (const step of result.steps) {
      expect(step.spawn).toHaveLength(step.cleared.length);
      for (const s of step.spawn) expect(s.fromRow).toBeLessThan(0);
      for (const f of step.fall) expect(f.toRow).toBeGreaterThan(f.fromRow);
    }
    expect(board.findMatches().groups).toHaveLength(0);
    expect(board.findPossibleMove()).not.toBeNull();
  });

  it('keeps gem ids unique', () => {
    const board = new Board({ seed: 11 });
    for (let i = 0; i < 30; i++) {
      const [a, b] = board.findPossibleMove()!;
      board.trySwap(a, b);
      const ids = board.snapshot().flat().map((g) => g.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('scores longer lines higher', () => {
    expect(scoreForGroup(3)).toBeLessThan(scoreForGroup(4));
    expect(scoreForGroup(4)).toBeLessThan(scoreForGroup(5));
  });
});

describe('replayGame (server-side validation)', () => {
  it('reproduces the client score from seed + moves', () => {
    const { moves, score } = playRandomGame(1234, 40);
    expect(replayGame(1234, moves)).toEqual({ score, validMoves: 40 });
  });

  it('rejects the moves if the seed does not match', () => {
    const { moves } = playRandomGame(1234, 40);
    expect(replayGame(999, moves).error).toBeDefined();
  });

  it('rejects moves after the time limit and out-of-order moves', () => {
    const { moves } = playRandomGame(5, 3);
    expect(replayGame(5, [{ ...moves[0], t: 999_999 }]).error).toBe('move after time limit');
    expect(replayGame(5, [{ ...moves[0], t: 500 }, { ...moves[1], t: 100 }]).error).toBe('moves out of order');
  });
});
