// The relief generator: the engine's fractal relief with a few more numbers
// (a twist of the noise, an island), or a grey image, as one height function
// over the terrain; a preview of it as pixels (colours with hill shading, or
// grey); and writing it into every chunk.
import { DEFAULT_RELIEF, gridBounds, Heightmap, Noise2D, relief, ReliefOptions, TerrainGrid } from 'omega-game-engine';

export interface GenSettings extends Required<ReliefOptions> {
  /** 0 to 1: bends the noise by more noise, for winding valleys and ridges. */
  warp: number;
  /** 0 to 1: sinks the ground towards the edges of the area, to the bottom of the relief. */
  island: number;
}

/** The terrain-space box the relief was made for (the island is its middle). */
export interface Area { x0: number; z0: number; x1: number; z1: number }

export const GEN_DEFAULT: GenSettings = {
  ...DEFAULT_RELIEF,
  seed: 7, scale: 360, amplitude: 120, octaves: 5, persistence: 0.42, ridges: 0.3, sharpness: 1.45, base: 8,
  warp: 0, island: 0,
};

export interface Preset { name: string; settings: Partial<GenSettings>; water?: boolean }

export const PRESETS: Preset[] = [
  { name: 'Original', settings: GEN_DEFAULT },
  { name: 'Colinas', settings: { scale: 300, amplitude: 55, octaves: 4, persistence: 0.45, ridges: 0, sharpness: 1, base: 10, warp: 0.25, island: 0 } },
  { name: 'Serra', settings: { scale: 420, amplitude: 180, octaves: 6, persistence: 0.48, ridges: 0.8, sharpness: 1.7, base: -4, warp: 0.3, island: 0 } },
  { name: 'Ilha', settings: { scale: 220, amplitude: 110, octaves: 5, persistence: 0.47, ridges: 0.25, sharpness: 1.25, base: 22, warp: 0.35, island: 0.9 }, water: true },
  { name: 'Planície', settings: { scale: 640, amplitude: 34, octaves: 3, persistence: 0.4, ridges: 0, sharpness: 2.2, base: 14, warp: 0.1, island: 0 } },
  { name: 'Ravinas', settings: { scale: 260, amplitude: 80, octaves: 5, persistence: 0.42, ridges: 1, sharpness: 0.6, base: -10, warp: 0.55, island: 0 } },
];

/** The numbers the generator's sliders show: key, label, min, max, step. */
export const SLIDERS: [keyof GenSettings, string, number, number, number][] = [
  ['scale', 'Escala', 60, 900, 10],
  ['amplitude', 'Altura', 0, 300, 1],
  ['base', 'Base', -60, 100, 1],
  ['octaves', 'Detalhe', 1, 8, 1],
  ['persistence', 'Rugosidade', 0.2, 0.75, 0.01],
  ['ridges', 'Cristas', 0, 1, 0.01],
  ['sharpness', 'Vales planos', 0.5, 3, 0.05],
  ['warp', 'Torção', 0, 1, 0.01],
  ['island', 'Ilha', 0, 1, 0.01],
];

/** The box around every chunk, in terrain space. */
export function areaOf(grid: TerrainGrid): Area {
  const b = gridBounds(grid), s = grid.settings.size;
  if (!b) return { x0: 0, z0: 0, x1: s, z1: s };
  return { x0: b.cx0 * s, z0: b.cz0 * s, x1: (b.cx1 + 1) * s, z1: (b.cz1 + 1) * s };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * The generator's height at a terrain-space point. With `image` the heights
 * come from it (stretched over `area`, grey 0 to 1 is base ∓ amplitude/2)
 * instead of the noise; the twist and the island work on either.
 */
export function heightField(s: GenSettings, area: Area, image?: Heightmap | null): (x: number, z: number) => number {
  const noise = new Noise2D(s.seed);
  const warpX = new Noise2D(s.seed + 1013), warpZ = new Noise2D(s.seed + 2027);
  const w = area.x1 - area.x0, d = area.z1 - area.z0;
  const cx = area.x0 + w / 2, cz = area.z0 + d / 2, r = Math.min(w, d) / 2;
  const floor = s.base - s.amplitude / 2 - 6;
  const reach = s.warp * s.scale * 0.45, f = 1 / s.scale;
  const fractal = (n: Noise2D, x: number, z: number) => n.get(x * f, z * f) + 0.5 * n.get(x * f * 2 + 5.2, z * f * 2 + 1.3);

  const sample = image
    ? (x: number, z: number) => {
        const u = Math.min(Math.max((x - area.x0) / w, 0), 1) * (image.width - 1);
        const v = Math.min(Math.max((z - area.z0) / d, 0), 1) * (image.height - 1);
        const i0 = Math.floor(u), j0 = Math.floor(v);
        const i1 = Math.min(i0 + 1, image.width - 1), j1 = Math.min(j0 + 1, image.height - 1);
        const tu = u - i0, tv = v - j0, at = (i: number, j: number) => image.data[j * image.width + i];
        const top = at(i0, j0) + (at(i1, j0) - at(i0, j0)) * tu;
        const bottom = at(i0, j1) + (at(i1, j1) - at(i0, j1)) * tu;
        return s.base + ((top + (bottom - top) * tv) / 65535 - 0.5) * s.amplitude;
      }
    : (x: number, z: number) => relief(noise, x, z, s);

  return (x, z) => {
    let px = x, pz = z;
    if (reach > 0) {
      px += fractal(warpX, x, z) * reach;
      pz += fractal(warpZ, x, z) * reach;
    }
    let h = sample(px, pz);
    if (s.island > 0) {
      const t = Math.hypot(x - cx, z - cz) / r;
      // A wobbly coast, so the island is not a circle.
      const edge = smoothstep(0.45, 1.02, t + noise.get(x * 0.012 + 40, z * 0.012 - 40) * 0.18);
      h += (floor - h) * edge * s.island;
    }
    return h;
  };
}

/** Writes the height function into every chunk (shared borders get the same value). */
export function generate(grid: TerrainGrid, height: (x: number, z: number) => number): void {
  const n = grid.settings.resolution;
  for (const c of grid.all()) {
    const sp = c.spacing;
    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) c.heights[j * (n + 1) + i] = height(c.originX + i * sp, c.originZ + j * sp);
    }
    c.heightVersion++;
  }
}

/**
 * The colour of the ground as the demo's rules paint it: grass, dirt on
 * slopes over 22°, rock over 33°, snow over 38 m; under the water, blue by depth.
 */
export function groundColour(h: number, slope: number, water: number | null): [number, number, number] {
  if (water !== null && h < water) {
    const t = Math.min((water - h) / 30, 1);
    return [40 - 22 * t, 112 - 72 * t, 150 - 60 * t];
  }
  if (water !== null && h < water + 1.2) return [196, 186, 140];
  if (h > 35 && slope < 40) return [236, 240, 246];
  if (slope > 33) return [128, 124, 118];
  if (slope > 22) return [122, 98, 66];
  const t = Math.min(Math.max((h + 20) / 60, 0), 1);
  return [70 + 30 * t, 112 + 22 * t, 46 + 14 * t];
}

export interface Preview { rgba: Uint8ClampedArray; min: number; max: number }

/**
 * A size × size picture of the heights over the area, north (−z) up: colours
 * with light from the north-west, or grey from the lowest to the highest.
 */
export function preview(height: (x: number, z: number) => number, area: Area, size: number, grey: boolean, water: number | null): Preview {
  const hs = new Float32Array(size * size);
  let min = Infinity, max = -Infinity;
  const sx = (area.x1 - area.x0) / (size - 1), sz = (area.z1 - area.z0) / (size - 1);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const h = height(area.x0 + i * sx, area.z0 + j * sz);
      hs[j * size + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  const rgba = new Uint8ClampedArray(size * size * 4);
  const span = max - min || 1;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = j * size + i, h = hs[k];
      let r: number, g: number, b: number;
      if (grey) {
        r = g = b = ((h - min) / span) * 255;
      } else {
        const l = hs[k - (i > 0 ? 1 : 0)], u = hs[k - (j > 0 ? size : 0)];
        const rr = hs[k + (i < size - 1 ? 1 : 0)], dd = hs[k + (j < size - 1 ? size : 0)];
        const slope = Math.atan(Math.hypot((rr - l) / (2 * sx), (dd - u) / (2 * sz))) * 180 / Math.PI;
        const shade = Math.min(Math.max(1 + ((l - h) / sx + (u - h) / sz) * 0.9, 0.45), 1.35);
        [r, g, b] = groundColour(h, slope, water);
        if (water === null || h >= water) { r *= shade; g *= shade; b *= shade; }
      }
      rgba[k * 4] = r; rgba[k * 4 + 1] = g; rgba[k * 4 + 2] = b; rgba[k * 4 + 3] = 255;
    }
  }
  return { rgba, min, max };
}

/**
 * A box blur `r` pixels each way (twice, so nearly a Gaussian), for 8-bit
 * images: their 256 greys are steps of a metre or so, which show as terraces.
 */
export function smoothHeightmap(map: Heightmap, r = 2): Heightmap {
  const { width: w, height: h } = map;
  let src = Float32Array.from(map.data);
  const tmp = new Float32Array(w * h);
  const pass = (from: Float32Array, to: Float32Array, horizontal: boolean) => {
    const lines = horizontal ? h : w, len = horizontal ? w : h;
    for (let l = 0; l < lines; l++) {
      for (let k = 0; k < len; k++) {
        let sum = 0;
        for (let d = -r; d <= r; d++) {
          const q = Math.min(Math.max(k + d, 0), len - 1);
          sum += from[horizontal ? l * w + q : q * w + l];
        }
        to[horizontal ? l * w + k : k * w + l] = sum / (2 * r + 1);
      }
    }
  };
  for (let n = 0; n < 2; n++) { pass(src, tmp, true); pass(tmp, src, false); }
  const data = new Uint16Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(src[i]);
  return { width: w, height: h, data };
}
