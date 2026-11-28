// Trees as meshes: a few low shapes (a trunk, a pine's tiered cone, a round
// crown) copied to every tree of a chunk and merged into one mesh per
// material, so a chunk's trees are four draws. The engine has no instancing
// yet: merging is what works with its lights, shadows and fog today.
import { vec2, vec3 } from 'gl-matrix';
import { LathePrimitive, MeshData, SpherePrimitive } from 'omega-game-engine';
import { Tree } from './scatter';

/** Unit shapes: 1 high (or across), standing on y = 0. */
const TRUNK = new LathePrimitive([[0.6, 1], [1, 0]], 6);
const PINE = new LathePrimitive([[0, 1], [0.42, 0.68], [0.26, 0.68], [0.72, 0.38], [0.46, 0.38], [1, 0.04], [0, 0]], 8);
const CROWN = new SpherePrimitive(1, 8, 6);

export interface TreeMeshes {
  trunks: MeshData;
  pines: MeshData;
  /** Broadleaf crowns in two greens. */
  crowns: [MeshData, MeshData];
}

interface Place { at: [number, number, number]; scale: [number, number, number]; turn: number }

/** Copies of a shape, scaled, turned about y and moved; normals follow the scale. */
export function merge(part: MeshData, places: Place[]): MeshData {
  const v: vec3[] = [], n: vec3[] = [], uv: vec2[] = [], idx: number[] = [];
  for (const { at, scale, turn } of places) {
    const base = v.length, cs = Math.cos(turn), sn = Math.sin(turn);
    part.vertices.forEach((p, i) => {
      const x = p[0] * scale[0], z = p[2] * scale[2];
      v.push([x * cs - z * sn + at[0], p[1] * scale[1] + at[1], x * sn + z * cs + at[2]]);
      const q = part.normals[i] ?? [0, 1, 0];
      const nx = q[0] / scale[0], ny = q[1] / scale[1], nz = q[2] / scale[2], l = Math.hypot(nx, ny, nz) || 1;
      n.push([(nx * cs - nz * sn) / l, ny / l, (nx * sn + nz * cs) / l]);
      uv.push(part.uvs[i] ?? [0, 0]);
    });
    for (const i of part.indices) idx.push(base + i);
  }
  const m = new MeshData(v, n, uv, idx);
  m.providedNormals = true;
  return m;
}

/** The trunk's radius for a tree (m): what walking bumps into. */
export const trunkRadius = (t: Tree) => t.radius * (t.kind === 'pine' ? 0.13 : 0.11);

export function treeMeshes(trees: Tree[]): TreeMeshes {
  const trunks: Place[] = [], pines: Place[] = [], crowns: [Place[], Place[]] = [[], []];
  for (const t of trees) {
    // A turn from the position, so a tree keeps it when the chunk is rebuilt.
    const turn = ((t.x * 12.9898 + t.z * 78.233) % 6.283);
    const r = trunkRadius(t);
    if (t.kind === 'pine') {
      trunks.push({ at: [t.x, t.y - 0.5, t.z], scale: [r, t.height * 0.3 + 0.5, r], turn });
      pines.push({ at: [t.x, t.y + t.height * 0.16, t.z], scale: [t.radius, t.height * 0.84, t.radius], turn });
    } else {
      const rise = t.height * 0.36;
      trunks.push({ at: [t.x, t.y - 0.5, t.z], scale: [r, t.height - rise * 1.6 + 0.5, r], turn });
      crowns[t.tint].push({ at: [t.x, t.y + t.height - rise, t.z], scale: [t.radius, rise, t.radius], turn });
    }
  }
  return { trunks: merge(TRUNK, trunks), pines: merge(PINE, pines), crowns: [merge(CROWN, crowns[0]), merge(CROWN, crowns[1])] };
}
