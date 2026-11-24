# Omega Terreno

A demo of the engine's terrain system (`src/terrain` in omega-engine, plan and
decisions in the "Omega Terreno: plano" doc): a 3 × 3 terrain of 128 m chunks,
a relief from seeded noise, painted by its layers' height and slope rules
(grass, dirt on gentle slopes, rock on steep ones, snow high up).
`npm run build -- terrain` bundles it into `docs/terrain/`.

## Using it

- Ver: drag to turn the camera, two fingers (or the wheel) to come closer.
- Subir, Baixar, Alisar, Aplanar, Ruído: sculpt where you drag; Tamanho and Força set the brush.
- Pintar: pick a layer and paint it over the rules; Apagar fades the painting back to the rules.
- Anular / Refazer (also Ctrl+Z, Ctrl+Shift+Z), Aplicar regras (writes the rules into the painting, to touch up by hand), Limpar pintura, Novo relevo.
- Largar bolas: five Rapier balls that roll down the chunks' heightfield colliders.
- `?quality=low|medium|high` (low turns off triplanar, halves the textures and draws far chunks coarser), `?seed=N` for another relief.

## The code

`src/main.ts` only: the scene (sun, ambient light, fog), the `TerrainBehaviour`
with its layers tuned for this relief, a Rapier `PhysicsWorld`, the orbit
camera, picking the ground with `terrain.raycast` from a ray through the
pointer, and the toolbar calling `sculptAt`, `paintAt`, `undo`, `redo`,
`bakeRules` and `clearPainting`.
