# Omega Terreno

A demo of the engine's terrain system (`src/terrain` in omega-engine, plan and
decisions in the "Omega Terreno: plano" doc): a 3 × 3 terrain of 128 m chunks,
a relief from seeded noise, painted by its layers' height and slope rules
(grass, dirt on gentle slopes, rock on steep ones, snow high up).
`npm run build -- terrain` bundles it into `docs/terrain/`.

## Using it

- Camera: in Ver, drag to turn it and double tap (or double click) to glide to a point. Two fingers pinch, twist and move it. With the mouse the right button turns, the middle one or Shift+drag moves, and the wheel comes closer to the cursor. WASD or the arrows move, Q and E turn, Centrar goes back to the start. It stays over the terrain.
- Subir, Baixar, Alisar, Aplanar, Ruído: sculpt where you drag; Tamanho, Força and Dureza set the brush.
- Rampa: drag from one point to another for a straight slope between their heights, as wide as Tamanho with edges as soft as Dureza (one undo step).
- Pintar: pick a layer and paint it over the rules; Apagar fades the painting back to the rules.
- Anular / Refazer (also Ctrl+Z, Ctrl+Shift+Z), Aplicar regras (writes the rules into the painting, to touch up by hand), Limpar pintura, Novo relevo.
- Largar bolas: five Rapier balls that roll down the chunks' heightfield colliders.
- `?quality=low|medium|high` (low turns off triplanar, halves the textures and draws far chunks coarser), `?seed=N` for another relief.

## The code

`src/ramp.ts`: the ramp, written like the engine's brushes (in terrain space) so it can move there later, with its tests. `src/main.ts`: the scene (sun, ambient light, fog), the `TerrainBehaviour`
with its layers tuned for this relief, a Rapier `PhysicsWorld`, the orbit
camera (grab to move, zoom to the cursor, keys, glide), picking the ground with `terrain.raycast` from a ray through the
pointer, and the toolbar calling `sculptAt`, `paintAt`, `undo`, `redo`,
`bakeRules` and `clearPainting`.
