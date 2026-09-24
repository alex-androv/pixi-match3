import {
  Application,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type Texture,
} from 'pixi.js';
import type { CascadeStep, Gem, GemPlacement, Pos } from '@match3/shared';
import { ParticleSystem } from './particles';
import { CELL, GEM_COLORS, createGemTextures, createParticleTexture, createSelectionTexture } from './textures';
import { Ease, Tweener } from './tween';

interface GemView {
  sprite: Sprite;
  type: number;
}

export interface GameViewOptions {
  rows: number;
  cols: number;
  /** Space reserved above the board for the React HUD, in CSS pixels. */
  topInset: number;
}

const cx = (col: number) => col * CELL + CELL / 2;
const cy = (row: number) => row * CELL + CELL / 2;

/**
 * Everything related to PixiJS: rendering, animations, input.
 * The view does not know the game rules. It receives commands from the controller
 * (Game) and reports player input through `onSwap`.
 */
export class GameView {
  /** Called when the player swaps two cells (by tap-tap or swipe). */
  onSwap: (a: Pos, b: Pos) => void = () => {};
  inputEnabled = false;

  private readonly tweens = new Tweener();
  private readonly gems = new Map<number, GemView>();
  private readonly tickListeners = new Set<(dt: number) => void>();

  private readonly board = new Container();
  private readonly shake = new Container();
  private readonly gemLayer = new Container();
  private readonly fxLayer = new Container();
  private readonly particles: ParticleSystem;
  private readonly selection: Sprite;
  private readonly hintSprites: Sprite[] = [];

  private readonly gemTextures: Texture[];
  private readonly ownedTextures: Texture[] = [];
  private selected: Pos | null = null;
  private pointerDown: { cell: Pos; x: number; y: number } | null = null;
  private hint: [Pos, Pos] | null = null;
  private time = 0;

  static async create(host: HTMLElement, options: GameViewOptions): Promise<GameView> {
    const app = new Application();
    await app.init({
      preference: 'webgl',
      resizeTo: host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      // A DPR of 3 on phones means 9x the pixels. Capping at 2 keeps FPS stable with no visible loss.
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    return new GameView(app, host, options);
  }

  private constructor(
    readonly app: Application,
    host: HTMLElement,
    private readonly options: GameViewOptions,
  ) {
    host.appendChild(app.canvas);
    app.canvas.style.touchAction = 'none';

    const renderer = app.renderer;
    this.gemTextures = createGemTextures(renderer);
    const particleTexture = createParticleTexture(renderer);
    const selectionTexture = createSelectionTexture(renderer);
    this.ownedTextures.push(...this.gemTextures, particleTexture, selectionTexture);
    this.particles = new ParticleSystem(particleTexture);
    this.selection = new Sprite(selectionTexture);
    this.selection.anchor.set(0.5);
    this.selection.visible = false;

    const w = options.cols * CELL;
    const h = options.rows * CELL;

    // board background: panel and checkerboard cells
    const bg = new Graphics().roundRect(-12, -12, w + 24, h + 24, 24).fill({ color: 0x1b1036, alpha: 0.85 });
    for (let r = 0; r < options.rows; r++) {
      for (let c = 0; c < options.cols; c++) {
        bg.roundRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4, 10).fill({
          color: (r + c) % 2 ? 0x2c1c52 : 0x352362,
        });
      }
    }

    // The mask hides new gems while they fall in from above the board.
    const mask = new Graphics().rect(0, 0, w, h).fill(0xffffff);
    this.gemLayer.mask = mask;

    this.shake.addChild(bg, this.selection, this.gemLayer, mask, this.fxLayer);
    this.fxLayer.addChild(this.particles.container);
    this.board.addChild(this.shake);
    app.stage.addChild(this.board);

    // One hit area for the whole board instead of listeners on 64 sprites.
    this.board.eventMode = 'static';
    this.board.hitArea = new Rectangle(0, 0, w, h);
    this.board.cursor = 'pointer';
    this.board.on('pointerdown', this.handlePointerDown);
    this.board.on('globalpointermove', this.handlePointerMove);
    this.board.on('pointerup', this.handlePointerUp);
    this.board.on('pointerupoutside', this.handlePointerUp);

    app.ticker.add(this.update);
    app.renderer.on('resize', this.layout);
    document.addEventListener('visibilitychange', this.handleVisibility);
    this.layout();
  }

  // ---------- public API ----------

  get fps(): number {
    return Math.round(this.app.ticker.FPS);
  }

  onTick(fn: (dt: number) => void): () => void {
    this.tickListeners.add(fn);
    return () => this.tickListeners.delete(fn);
  }

  /** Instantly replaces the board and plays the intro animation. */
  async setBoard(grid: Gem[][]): Promise<void> {
    this.tweens.clear();
    for (const g of this.gems.values()) g.sprite.destroy();
    this.gems.clear();
    this.setSelected(null);
    this.hideHint();

    const jobs: Promise<void>[] = [];
    grid.forEach((line, row) =>
      line.forEach((gem, col) => {
        const sprite = this.createGem(gem.id, gem.type, col, row - this.options.rows - 1);
        jobs.push(
          this.tweens.to(sprite, { y: cy(row) }, {
            duration: 450,
            delay: col * 35 + (this.options.rows - row) * 25,
            ease: Ease.outBounce,
          }),
        );
      }),
    );
    await Promise.all(jobs);
  }

  async animateSwap(a: Pos, b: Pos, valid: boolean): Promise<void> {
    this.setSelected(null);
    this.hideHint();
    const ga = this.gemAt(a);
    const gb = this.gemAt(b);
    if (!ga || !gb) return;

    const go = (s: Sprite, to: Pos) => this.tweens.to(s, { x: cx(to.col), y: cy(to.row) }, { duration: 160, ease: Ease.inOutQuad });
    await Promise.all([go(ga.sprite, b), go(gb.sprite, a)]);
    if (!valid) {
      await Promise.all([go(ga.sprite, a), go(gb.sprite, b)]);
      await this.wobble(ga.sprite);
    }
  }

  async animateStep(step: CascadeStep): Promise<void> {
    // 1. clear matched gems
    const clears = step.cleared.map(async (c) => {
      const g = this.gems.get(c.id);
      if (!g) return;
      this.gems.delete(c.id);
      this.particles.burst(cx(c.col), cy(c.row), GEM_COLORS[c.type], 9);
      await this.tweens.to(g.sprite.scale, { x: 1.25, y: 1.25 }, { duration: 80 });
      await Promise.all([
        this.tweens.to(g.sprite.scale, { x: 0, y: 0 }, { duration: 150, ease: Ease.inQuad }),
        this.tweens.to(g.sprite, { alpha: 0 }, { duration: 150 }),
      ]);
      this.tweens.kill(g.sprite);
      this.tweens.kill(g.sprite.scale);
      g.sprite.destroy();
    });

    const mx = step.cleared.reduce((s, c) => s + cx(c.col), 0) / step.cleared.length;
    const my = step.cleared.reduce((s, c) => s + cy(c.row), 0) / step.cleared.length;
    this.popup(`+${step.points}`, mx, my, step.multiplier > 1 ? 0xffd93d : 0xffffff);
    if (step.multiplier >= 2) this.popup(`x${step.multiplier}`, mx, my - 36, 0xff7ab8, 0.8);
    if (step.multiplier >= 3) void this.screenShake(4 + step.multiplier);

    await Promise.all(clears);

    // 2. gravity: existing gems fall down, new ones spawn above the board
    const falls: Promise<void>[] = [];
    for (const f of step.fall) {
      const g = this.gems.get(f.id);
      if (!g) continue;
      const dist = f.toRow - f.fromRow;
      falls.push(this.tweens.to(g.sprite, { y: cy(f.toRow) }, { duration: 220 + dist * 45, ease: Ease.outBounce }));
    }
    for (const s of step.spawn) {
      const sprite = this.createGem(s.id, s.type, s.col, s.fromRow);
      const dist = s.row - s.fromRow;
      falls.push(this.tweens.to(sprite, { y: cy(s.row) }, { duration: 220 + dist * 45, ease: Ease.outBounce }));
    }
    await Promise.all(falls);
  }

  async animateShuffle(placements: GemPlacement[]): Promise<void> {
    this.popup('Shuffle!', (this.options.cols * CELL) / 2, (this.options.rows * CELL) / 2, 0x9be7ff, 1.2);
    const centerX = (this.options.cols * CELL) / 2;
    const centerY = (this.options.rows * CELL) / 2;
    const all = [...this.gems.values()];
    await Promise.all(all.map((g) => this.tweens.to(g.sprite, { x: centerX, y: centerY }, { duration: 300, ease: Ease.inQuad })));
    await Promise.all(
      placements.map((p) => {
        const g = this.gems.get(p.id);
        return g ? this.tweens.to(g.sprite, { x: cx(p.col), y: cy(p.row) }, { duration: 400, ease: Ease.outBack }) : undefined;
      }),
    );
  }

  showHint(move: [Pos, Pos]): void {
    this.hint = move;
  }

  hideHint(): void {
    this.hint = null;
    for (const s of this.hintSprites) s.scale.set(1);
    this.hintSprites.length = 0;
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.handleVisibility);
    this.app.renderer.off('resize', this.layout);
    this.app.ticker.remove(this.update);
    this.tweens.clear();
    this.tickListeners.clear();
    this.app.destroy({ removeView: true }, { children: true });
    // Generated textures live in GPU memory: free them explicitly.
    for (const t of this.ownedTextures) t.destroy(true);
  }

  // ---------- internals ----------

  private readonly update = () => {
    const dt = this.app.ticker.deltaMS;
    this.time += dt;
    this.tweens.update(dt);
    this.particles.update(dt);

    if (this.selection.visible) {
      const k = 1 + Math.sin(this.time / 140) * 0.05;
      this.selection.scale.set(k);
    }
    if (this.hint) {
      this.hintSprites.length = 0;
      const k = 1 + Math.max(0, Math.sin(this.time / 160)) * 0.14;
      for (const p of this.hint) {
        const g = this.gemAt(p);
        if (g) {
          g.sprite.scale.set(k);
          this.hintSprites.push(g.sprite);
        }
      }
    }
    for (const fn of this.tickListeners) fn(dt);
  };

  /** Fits the board into the available screen size (phone, desktop, WebView). */
  private readonly layout = () => {
    const { width, height } = this.app.screen;
    const bw = this.options.cols * CELL + 24;
    const bh = this.options.rows * CELL + 24;
    const top = this.options.topInset;
    const scale = Math.min((width - 16) / bw, (height - top - 16) / bh, 1.25);
    this.board.scale.set(scale);
    this.board.x = (width - this.options.cols * CELL * scale) / 2;
    this.board.y = top + Math.max(0, (height - top - bh * scale) / 2) + 12 * scale;
  };

  /** Pauses rendering in a background tab or a minimized WebView to save battery. */
  private readonly handleVisibility = () => {
    if (document.hidden) this.app.ticker.stop();
    else this.app.ticker.start();
  };

  private createGem(id: number, type: number, col: number, row: number): Sprite {
    const sprite = new Sprite(this.gemTextures[type]);
    sprite.anchor.set(0.5);
    sprite.position.set(cx(col), cy(row));
    sprite.scale.set(1);
    this.gemLayer.addChild(sprite);
    this.gems.set(id, { sprite, type });
    return sprite;
  }

  private gemAt(pos: Pos): GemView | undefined {
    const x = cx(pos.col);
    const y = cy(pos.row);
    for (const g of this.gems.values()) {
      if (Math.abs(g.sprite.x - x) < 1 && Math.abs(g.sprite.y - y) < 1) return g;
    }
    return undefined;
  }

  private cellFromEvent(e: FederatedPointerEvent): Pos | null {
    const p = this.shake.toLocal(e.global);
    const col = Math.floor(p.x / CELL);
    const row = Math.floor(p.y / CELL);
    if (row < 0 || col < 0 || row >= this.options.rows || col >= this.options.cols) return null;
    return { row, col };
  }

  private setSelected(pos: Pos | null): void {
    this.selected = pos;
    this.selection.visible = pos !== null;
    if (pos) this.selection.position.set(cx(pos.col), cy(pos.row));
  }

  private readonly handlePointerDown = (e: FederatedPointerEvent) => {
    if (!this.inputEnabled) return;
    const cell = this.cellFromEvent(e);
    if (!cell) return;
    this.pointerDown = { cell, x: e.global.x, y: e.global.y };
  };

  private readonly handlePointerMove = (e: FederatedPointerEvent) => {
    const down = this.pointerDown;
    if (!down || !this.inputEnabled) return;
    const dx = e.global.x - down.x;
    const dy = e.global.y - down.y;
    const threshold = CELL * 0.35 * this.board.scale.x;
    if (Math.hypot(dx, dy) < threshold) return;

    // swipe: direction is the dominant axis
    const target =
      Math.abs(dx) > Math.abs(dy)
        ? { row: down.cell.row, col: down.cell.col + Math.sign(dx) }
        : { row: down.cell.row + Math.sign(dy), col: down.cell.col };
    this.pointerDown = null;
    this.setSelected(null);
    if (target.row >= 0 && target.col >= 0 && target.row < this.options.rows && target.col < this.options.cols) {
      this.onSwap(down.cell, target);
    }
  };

  private readonly handlePointerUp = () => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down || !this.inputEnabled) return;

    // tap: select, then tap a neighbour to swap
    const sel = this.selected;
    if (!sel) return this.setSelected(down.cell);
    if (sel.row === down.cell.row && sel.col === down.cell.col) return this.setSelected(null);
    if (Math.abs(sel.row - down.cell.row) + Math.abs(sel.col - down.cell.col) === 1) {
      this.setSelected(null);
      this.onSwap(sel, down.cell);
      return;
    }
    this.setSelected(down.cell);
  };

  private popup(text: string, x: number, y: number, color: number, scale = 1): void {
    const label = new Text({
      text,
      style: {
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        fontSize: 30,
        fontWeight: '900',
        fill: color,
        stroke: { color: 0x2a1450, width: 6 },
      },
    });
    label.anchor.set(0.5);
    label.position.set(x, y);
    label.scale.set(0.2 * scale);
    this.fxLayer.addChild(label);
    void (async () => {
      await this.tweens.to(label.scale, { x: scale, y: scale }, { duration: 220, ease: Ease.outBack });
      await Promise.all([
        this.tweens.to(label, { y: y - 50 }, { duration: 650, ease: Ease.outQuad }),
        this.tweens.to(label, { alpha: 0 }, { duration: 650, delay: 150, ease: Ease.inQuad }),
      ]);
      label.destroy();
    })();
  }

  private async wobble(sprite: Sprite): Promise<void> {
    const x = sprite.x;
    for (const dx of [-6, 6, -3, 0]) await this.tweens.to(sprite, { x: x + dx }, { duration: 45 });
  }

  private async screenShake(power: number): Promise<void> {
    for (let i = 0; i < 6; i++) {
      const k = power * (1 - i / 6);
      await this.tweens.to(this.shake, { x: (Math.random() - 0.5) * k * 2, y: (Math.random() - 0.5) * k * 2 }, { duration: 30 });
    }
    await this.tweens.to(this.shake, { x: 0, y: 0 }, { duration: 40 });
  }
}
