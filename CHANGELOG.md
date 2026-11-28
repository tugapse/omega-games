# Changelog

## Unreleased

- Omega Terreno: a relief generator (☰ or G): presets, a seed and nine numbers (scale, height, base, detail, roughness, ridges, flat valleys, twist, island), a map preview, the terrain following live as one undo step; heightmaps out as PNG or .r16 and in from any grey image.
- Omega Terreno: ⟲ Recomeçar do zero in the ☰ menu (tapped twice): back to 3 × 3 chunks of the original relief, no painting, water or balls.
- Omega Terreno: a camera that moves (grab, zoom to the cursor, keys, double tap, Centrar), and new tools: Rampa, Socalcos, Carimbo (hill, crater, plateau, volcano), Erosão and Aumentar (up to 25 chunks); a Dureza slider; water with a level; Andar, on foot at eye height; the terrain saves itself in the browser and to `.terreno` files.
- The games live in `src/<game>/`.
- The READMEs show each game: pictures, controls, what it is made of.
- Omega Terreno (`src/terrain/`): a demo of the engine's terrain (6.0.0), to sculpt and paint with a finger or the mouse, undo, bake the rules, make a new relief and drop Rapier balls; a card on the games page.
- The games move here from the engine repository, with their history: bowling,
  golf, platformer and drift. They import `omega-game-engine`, pointed at the
  engine's source next to this repository by the build and the tests.
- GitHub Pages serves `docs/` from `develop`.
