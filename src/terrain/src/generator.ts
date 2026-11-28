// The relief generator's panel data: the numbers it shows, the presets, and
// a coloured preview of a relief from above. The relief itself is the
// engine's (heightField: the fractal relief or an image, with a twist and an
// island).
import { DEFAULT_RELIEF_FIELD, ReliefFieldOptions, ReliefArea, sampleField } from 'omega-game-engine';

export type GenSettings = Required<ReliefFieldOptions>;
export type Area = ReliefArea;

export const GEN_DEFAULT: GenSettings = {
  ...DEFAULT_RELIEF_FIELD,
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
  const { heights: hs, min, max } = sampleField(height, area, size);
  const sx = (area.x1 - area.x0) / (size - 1), sz = (area.z1 - area.z0) / (size - 1);
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

