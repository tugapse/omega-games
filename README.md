# Omega Games

Small games (and a demo or two) made with the [Omega game engine](https://github.com/tugapse/omega-game-engine),
each one built to try the engine out on something real. All the cars, characters,
tracks, sounds and music are our own, made in code.

Play them at https://tugapse.github.io/omega-games/.

| Game | What it is |
| --- | --- |
| [bowling](bowling/) | Bowling with Rapier physics, swipe to throw, obstacle lanes, a CPU and replays. |
| [golf](golf/) | Nine holes of Vale Omega with its own ball physics, a swing meter and CPU players. |
| [platformer](platformer/) | Nine levels in three worlds with moving platforms, bosses and saved progress. |
| [drift](drift/) | A drift racer of round toy cars: six tracks, cups, a ghost, drift points and turbo. |
| [terrain](terrain/) | A demo of the engine's terrain: sculpt and paint a 3 × 3 terrain painted by height and slope rules, and roll balls down it. |

Each folder has its own README with the controls and how the code is laid out.

## Working on it

The games import `omega-game-engine` from the engine's source. Until the engine is
on npm, the build and the tests point that name to the
[omega-engine](https://github.com/tugapse/omega-game-engine) repository checked out
next to this one (`../omega-engine`), or to the folder in `OMEGA_ENGINE`.

```
npm install
npm test                    # every game's tests (vitest, in Node)
npm run check               # type check
npm run build               # bundles every game into docs/<game>/
npm run build -- drift      # one game
cd docs && python3 -m http.server 8790
```

GitHub Pages serves `docs/` from `develop`, so the bundles are committed with the
source. Git-flow: work on a branch from `develop` and merge it back with `--no-ff`.
