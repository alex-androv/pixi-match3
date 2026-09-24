/**
 * A small promise-based tween engine driven by the Pixi ticker.
 * Awaitable animations make sequences easy to read:
 *   await tweens.to(sprite, { x: 100 }, { duration: 200 });
 */
export type Ease = (t: number) => number;

export const Ease = {
  linear: (t: number) => t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inQuad: (t: number) => t * t,
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  outBounce: (t: number) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
} satisfies Record<string, Ease>;

type NumericProps<T> = { [K in keyof T as T[K] extends number ? K : never]?: number };

interface TweenOptions {
  duration: number;
  delay?: number;
  ease?: Ease;
}

interface ActiveTween {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  duration: number;
  delay: number;
  elapsed: number;
  started: boolean;
  ease: Ease;
  resolve: () => void;
}

export class Tweener {
  private tweens: ActiveTween[] = [];

  to<T extends object>(target: T, props: NumericProps<T>, options: TweenOptions): Promise<void> {
    return new Promise((resolve) => {
      const t = target as unknown as Record<string, number>;
      const to = props as Record<string, number>;
      const from: Record<string, number> = {};
      this.tweens.push({
        target: t,
        from,
        to,
        duration: Math.max(1, options.duration),
        delay: options.delay ?? 0,
        elapsed: 0,
        started: false,
        ease: options.ease ?? Ease.outQuad,
        resolve,
      });
    });
  }

  wait(ms: number): Promise<void> {
    return this.to({ v: 0 }, { v: 1 }, { duration: ms, ease: Ease.linear });
  }

  update(deltaMs: number): void {
    if (this.tweens.length === 0) return;
    const done: ActiveTween[] = [];
    for (const tw of this.tweens) {
      tw.elapsed += deltaMs;
      const local = tw.elapsed - tw.delay;
      if (local < 0) continue;
      if (!tw.started) {
        // Capture start values when the tween actually starts (after the delay).
        tw.started = true;
        for (const key of Object.keys(tw.to)) tw.from[key] = tw.target[key];
      }
      const p = Math.min(1, local / tw.duration);
      const k = tw.ease(p);
      for (const key of Object.keys(tw.to)) {
        tw.target[key] = tw.from[key] + (tw.to[key] - tw.from[key]) * k;
      }
      if (p >= 1) done.push(tw);
    }
    if (done.length) {
      this.tweens = this.tweens.filter((tw) => !done.includes(tw));
      for (const tw of done) tw.resolve();
    }
  }

  /** Stops tweens of an object (for example, before it is destroyed). Their promises resolve. */
  kill(target: object): void {
    const killed = this.tweens.filter((tw) => tw.target === target);
    this.tweens = this.tweens.filter((tw) => tw.target !== target);
    killed.forEach((tw) => tw.resolve());
  }

  clear(): void {
    const all = this.tweens;
    this.tweens = [];
    all.forEach((tw) => tw.resolve());
  }
}
