import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LEADERBOARD_SIZE, type LeaderboardEntry } from '@match3/shared';

/** Top scores in memory with persistence to a JSON file (debounced writes). */
export class Leaderboard {
  private entries: LeaderboardEntry[] = [];
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (Array.isArray(data)) this.entries = data.slice(0, LEADERBOARD_SIZE);
    } catch {
      this.entries = [];
    }
  }

  top(): LeaderboardEntry[] {
    return this.entries;
  }

  /** Adds a result. Returns its rank (1-based) or null if it did not make the top list. */
  add(entry: LeaderboardEntry): number | null {
    const next = [...this.entries, entry].sort((a, b) => b.score - a.score || a.at - b.at);
    const rank = next.indexOf(entry);
    if (rank >= LEADERBOARD_SIZE) return null;
    this.entries = next.slice(0, LEADERBOARD_SIZE);
    this.scheduleSave();
    return rank + 1;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      try {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(this.file, JSON.stringify(this.entries, null, 2));
      } catch (err) {
        console.error('[leaderboard] save failed', err);
      }
    }, 500);
  }
}
