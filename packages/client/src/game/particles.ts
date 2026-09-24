import { Container, Sprite, type Texture } from 'pixi.js';

interface Particle {
  sprite: Sprite;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  active: boolean;
}

/**
 * Particle bursts with an object pool: sprites are reused instead of being
 * created and destroyed for every match, which avoids GC pauses on weak phones.
 */
export class ParticleSystem {
  readonly container = new Container();
  private pool: Particle[] = [];

  constructor(private readonly texture: Texture) {}

  burst(x: number, y: number, color: number, count = 10): void {
    for (let i = 0; i < count; i++) {
      const p = this.obtain();
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.15 + Math.random() * 0.35; // px per ms
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 0.15;
      p.maxLife = p.life = 400 + Math.random() * 350;
      p.sprite.position.set(x, y);
      p.sprite.tint = color;
      p.sprite.alpha = 1;
      p.sprite.scale.set(0.6 + Math.random() * 0.8);
      p.sprite.visible = true;
    }
  }

  update(dt: number): void {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        p.sprite.visible = false;
        continue;
      }
      p.vy += 0.0009 * dt; // gravity
      p.sprite.x += p.vx * dt;
      p.sprite.y += p.vy * dt;
      const k = p.life / p.maxLife;
      p.sprite.alpha = k;
      p.sprite.scale.set(p.sprite.scale.x * (0.995 ** (dt / 16)));
    }
  }

  get activeCount(): number {
    return this.pool.filter((p) => p.active).length;
  }

  private obtain(): Particle {
    let p = this.pool.find((q) => !q.active);
    if (!p) {
      const sprite = new Sprite(this.texture);
      sprite.anchor.set(0.5);
      sprite.blendMode = 'add';
      this.container.addChild(sprite);
      p = { sprite, vx: 0, vy: 0, life: 0, maxLife: 1, active: false };
      this.pool.push(p);
    }
    p.active = true;
    return p;
  }
}
