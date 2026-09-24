import { Container, Graphics, type Renderer, type Texture } from 'pixi.js';

export const CELL = 64;
const GEM = 52;
const R = GEM / 2;

export const GEM_COLORS = [0xff4d6d, 0xffa62b, 0xffd93d, 0x4cd97b, 0x4d9fff, 0xb76cff];

function lighten(color: number, k: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = (c: number) => Math.min(255, Math.round(c + (255 - c) * k));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

function darken(color: number, k: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const f = (c: number) => Math.round(c * (1 - k));
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

function drawShape(g: Graphics, type: number, scale: number): Graphics {
  const r = R * scale;
  switch (type) {
    case 0:
      return g.circle(0, 0, r);
    case 1:
      return g.poly([0, -r, r * 0.85, 0, 0, r, -r * 0.85, 0]);
    case 2:
      return g.star(0, 0, 5, r, r * 0.5, 0);
    case 3:
      return g.regularPoly(0, 0, r, 6, Math.PI / 6);
    case 4:
      return g.roundRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7, r * 0.3);
    default:
      return g.poly([0, -r, r * 0.95, r * 0.75, -r * 0.95, r * 0.75]);
  }
}

/**
 * Gem textures are drawn once with vector Graphics and baked into textures.
 * Every gem sprite reuses them, so the renderer can batch them into a few draw calls
 * (much cheaper than keeping 64 separate Graphics objects on screen).
 */
export function createGemTextures(renderer: Renderer): Texture[] {
  return GEM_COLORS.map((color, type) => {
    const g = new Graphics();
    // shadow
    drawShape(g, type, 1).fill({ color: 0x000000, alpha: 0.25 });
    g.position.set(0, 3);
    const body = new Graphics();
    drawShape(body, type, 1).fill({ color: darken(color, 0.25) });
    drawShape(body, type, 0.86).fill({ color });
    drawShape(body, type, 0.5).fill({ color: lighten(color, 0.35), alpha: 0.6 });
    body.ellipse(-R * 0.25, -R * 0.4, R * 0.28, R * 0.16).fill({ color: 0xffffff, alpha: 0.7 });

    const root = new Container();
    root.addChild(g, body);
    const texture = renderer.generateTexture({
      target: root,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      antialias: true,
    });
    root.destroy({ children: true });
    return texture;
  });
}

export function createParticleTexture(renderer: Renderer): Texture {
  const g = new Graphics().circle(0, 0, 6).fill({ color: 0xffffff });
  const texture = renderer.generateTexture({ target: g, resolution: 2, antialias: true });
  g.destroy();
  return texture;
}

export function createSelectionTexture(renderer: Renderer): Texture {
  const s = CELL - 4;
  const g = new Graphics()
    .roundRect(0, 0, s, s, 14)
    .stroke({ width: 4, color: 0xffffff, alpha: 0.95 })
    .roundRect(0, 0, s, s, 14)
    .fill({ color: 0xffffff, alpha: 0.12 });
  const texture = renderer.generateTexture({ target: g, resolution: 2, antialias: true });
  g.destroy();
  return texture;
}
