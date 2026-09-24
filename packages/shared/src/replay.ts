import { Board } from './board';
import { GAME_DURATION_MS, MAX_MOVES_PER_GAME } from './constants';
import type { MoveRecord } from './protocol';

export interface ReplayResult {
  score: number;
  validMoves: number;
  error?: string;
}

/**
 * Replays a game from the seed and the list of moves. The client uses the same Board,
 * so an honest client and the server always get the same score.
 * This is server-side validation: a score sent by the client is not trusted.
 */
export function replayGame(seed: number, moves: MoveRecord[]): ReplayResult {
  if (moves.length > MAX_MOVES_PER_GAME) return { score: 0, validMoves: 0, error: 'too many moves' };

  const board = new Board({ seed });
  let score = 0;
  let validMoves = 0;
  let lastT = -1;

  for (const m of moves) {
    if (m.t < lastT) return { score: 0, validMoves, error: 'moves out of order' };
    if (m.t > GAME_DURATION_MS) return { score: 0, validMoves, error: 'move after time limit' };
    lastT = m.t;

    const result = board.trySwap({ row: m.r1, col: m.c1 }, { row: m.r2, col: m.c2 });
    if (!result.valid) return { score: 0, validMoves, error: 'invalid move' };
    score += result.points;
    validMoves++;
  }
  return { score, validMoves };
}
