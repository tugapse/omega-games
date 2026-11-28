# Omega Terreno

**Sculpt, paint, flood and walk a terrain, in the browser, with a finger or the mouse.**
A demo of the Omega engine's terrain system: chunks of heightfield painted by height and slope
rules, Rapier colliders, undo, LOD, and a toolbox built on top of it.

**[▶ Play it](https://tugapse.github.io/omega-games/terrain/)** · works on phones

![A lake among green hills, a volcano cut by gullies on its shore](media/hero.jpg)

| | |
| --- | --- |
| **Terrain** | 3 × 3 chunks of 128 m to start (up to 25), 129 × 129 heights each, seeded relief |
| **Painting** | grass, dirt on slopes over 22°, rock over 33°, snow over 38 m; paint any layer over the rules |
| **Physics** | Rapier heightfield colliders, rebuilt after each stroke; balls to roll down it |
| **Saving** | by itself in the browser (gzipped, ~400 KB painted), or to a `.terreno` file |
| **Relief** | a generator with presets and nine numbers, live on the terrain; heightmaps in and out (PNG, .r16) |
| **Tests** | 26 (the ramp, the brushes, growing, saving, the generator), in Node |

## What you can do

<table>
<tr>
<td width="33%"><img src="media/ramp.jpg" alt="A ramp being drawn across a valley, shown as a cyan strip"><br><b>Rampa</b>: drag from A to B for a straight slope between their heights; the strip shows where it goes, with its length and grade.</td>
<td width="33%"><img src="media/tools.jpg" alt="A crater, an eroded volcano and terraces side by side"><br><b>Carimbo</b> and <b>Socalcos</b>: a hill, crater, plateau or volcano in one tap; steps cut into a slope.</td>
<td width="33%"><img src="media/erosion.jpg" alt="A volcano with gullies cut down its sides"><br><b>Erosão</b>: drops of rain run downhill under the brush, cutting gullies and filling hollows.</td>
</tr>
<tr>
<td><img src="media/grow.jpg" alt="The terrain from above with green squares and plus signs around its edge"><br><b>Aumentar</b>: a + on every free side; a new chunk carries the relief on and bends to meet what you sculpted.</td>
<td><img src="media/walk.jpg" alt="A grassy slope seen at eye height"><br><b>Andar</b>: on foot at eye height (WASD, a touch stick on phones); in the water you swim.</td>
<td><img src="media/phone.jpg" alt="The demo on a phone, the stamp shapes over the toolbar" height="260"><br>The same on a phone: one finger works the tool, two move the camera.</td>
</tr>
</table>

### The relief generator

![The generator panel beside an island it made, its preview in colour](media/generator.jpg)

**☰ → ⛰ Gerador de relevo** (or **G**) opens a panel with a map of the relief from above. While a
slider moves, the map follows once the finger rests; with **Ver no terreno** on, the terrain
follows a moment after you let go. Everything the panel does until you close it, sculpt or press **✓ Feito** is one
undo step (painting made for the old relief is cleared first, so the rules paint the new one), and
**↺ Repor** takes it back.

| Number | What it changes |
| --- | --- |
| **Semente** 🎲 | which relief, for the same numbers |
| **Escala** | metres across the largest features |
| **Altura** / **Base** | how far from the lowest point to the highest, and where its middle sits |
| **Detalhe** | layers of smaller bumps on the big ones |
| **Rugosidade** | how much of each smaller layer is kept |
| **Cristas** | rolling hills (0) to sharp ridges (1) |
| **Vales planos** | flattens the valleys and lifts the peaks |
| **Torção** | bends the relief by more noise: winding valleys and ridges |
| **Ilha** | sinks the ground towards the edges, with a wobbly coast |

Presets to start from: **Original**, **Colinas**, **Serra**, **Ilha** (turns the water on),
**Planície**, **Ravinas**. A tap on the map takes the camera there; **Em cinzento** shows it as a
heightmap.

**Heightmaps:** **⤓ PNG** saves the terrain as it is (sculpting included) as a grey image, a pixel
per vertex, black −64 m and white 192 m; **⤓ .r16** saves it in 16 bits for other programs.
**Abrir imagem…** takes any grey image (or a square .r16) as the relief: it is stretched over the
terrain, an 8-bit image is smoothed so its greys don't show as steps, and Altura and Base set
what black and white mean (opening the demo's own PNG puts it back as it was). Torção and Ilha
work on an image too.

### The tools

| Tool | What it does | Settings |
| --- | --- | --- |
| ✥ **Ver** | turns the camera; double tap glides to a point | |
| ▲ **Subir** / ▼ **Baixar** | raises or lowers the ground where you drag | Tamanho, Força, Dureza |
| ≈ **Alisar** | smooths bumps | Tamanho, Força, Dureza |
| ▬ **Aplanar** | flattens to the height where the stroke began | Tamanho, Força, Dureza |
| ◢ **Rampa** | a straight slope from where you press to where you let go | Tamanho = width, Dureza = soft edges |
| ⁂ **Ruído** | roughens the ground with noise | Tamanho, Força, Dureza |
| ≣ **Socalcos** | pulls the slope into flat steps | **Degrau** (2–20 m) |
| ◉ **Carimbo** | Monte, Cratera, Planalto or Vulcão, in one tap | Tamanho = width, Força = height (up to 40 m) |
| ☂ **Erosão** | hydraulic erosion under the brush | Tamanho, Força, Dureza |
| ⊞ **Aumentar** | adds a chunk on a free side (not undone) | |
| ✎ **Pintar** / ⌫ **Apagar** | paints a layer over the rules, or fades the painting back to them | the layer, Tamanho, Força |

Every stroke, ramp and stamp is one step of **↶ Anular** / **↷ Refazer** (Ctrl+Z, Ctrl+Shift+Z).
**💧 Água** floods the terrain to a level you set; **● Bolas** drops five Rapier balls;
the **☰** menu saves, exports and opens files, bakes the rules into the painting, clears it
and opens the relief generator.

### Moving around

| | Mouse and keyboard | Touch |
| --- | --- | --- |
| Turn | drag in Ver, or the right button with any tool; Q / E | one finger in Ver, or twist two fingers |
| Move | middle button or Shift+drag; WASD or the arrows | drag two fingers |
| Come closer | the wheel (towards the cursor) | pinch (towards the fingers) |
| Go to a point | double click in Ver | double tap in Ver |
| Back to the start | ⌖ Centrar | ⌖ Centrar |
| Walk (Andar) | drag to look, WASD, Shift runs, Esc leaves | left of the screen is a stick, the rest looks |

The camera never leaves the terrain.

## How it is made

```mermaid
flowchart LR
  main["main.ts<br/>scene · camera · tools · UI · water · saving · walking"]
  ramp["ramp.ts<br/>straight ramp"]
  brushes["brushes.ts<br/>terraces · stamps · erosion"]
  grow["grow.ts<br/>a new chunk from the relief"]
  save["save.ts<br/>gzip + base64"]
  gen["generator.ts<br/>relief · preview · images"]
  engine[("omega-game-engine<br/>TerrainBehaviour · TerrainGrid<br/>sculptAt · paintAt · history<br/>PhysicsWorld (Rapier)")]
  main --> ramp & brushes & grow & save & gen
  ramp & brushes & grow & gen --> engine
  main --> engine
```

The new brushes are written like the engine's own (`terrain-brush.ts`): in terrain space, on
the grid's global vertices, returning the vertices they changed, so they can move into the
engine as they are.

| File | |
| --- | --- |
| `src/main.ts` | the scene (sun, ambient light, fog), the `TerrainBehaviour` and its layers, the Rapier world, the orbit camera (grab to move, zoom to the cursor, keys, glide), picking the ground with `terrain.raycast`, the tools and the overlay (the ramp strip, the + markers, the touch stick), the water, saving, walking, the generator's panel (live on the terrain as one undo step, PNG and .r16 in and out), on-screen errors with the GPU's name |
| `src/ramp.ts` | `ramp()` lays a straight slope between two points with soft edges; `rampAt()` does it from world points as one undo step |
| `src/brushes.ts` | `terrace()`, `stamp()` with its four profiles, and `erode()`: droplet erosion worked on a copy of the heights (about 2 ms for 20 drops) |
| `src/grow.ts` | `fillChunk()`: the relief over a new chunk, shifted near the borders it shares (inverse-distance from the shared vertices) so it meets sculpted ground exactly |
| `src/generator.ts` | `heightField()`: the engine's fractal relief (or a grey image) with a twist of the noise and an island, as one height function; `generate()` writes it into every chunk; `preview()` draws it from above, coloured like the rules with hill shading, or grey; the presets; `smoothHeightmap()` for 8-bit images |
| `src/save.ts` | the saved world (chunks as the engine saves them, seed, water) gzipped with `CompressionStream`, and base64 |

### Page options

| Option | |
| --- | --- |
| `?quality=low\|medium\|high` | low turns off triplanar, halves the textures and draws far chunks coarser |
| `?seed=N` | another seed for the relief (and skips the saved terrain) |
| `?wateralpha=0.7` | how see-through the water is (1 is opaque) |
| `?debug` | shows the diagnostics line (GPU, shaders, GL errors) |

```sh
npm run build -- terrain   # → docs/terrain/
npx vitest run src/terrain
```
