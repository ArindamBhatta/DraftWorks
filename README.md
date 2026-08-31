# DraftWorks

A web-based 2D CAD drafting application for civil engineering — structural drawings, architectural plans, and 2D elevations, running entirely in the browser. Similar to AutoCAD, but rethought around a simpler, proactive UI and a save model that never makes you think about saving.

DraftWorks pairs an OCCT (OpenCascade) geometry kernel compiled to WebAssembly with a Three.js renderer, so drafting stays precise (real B-Rep geometry, not just pixels) while running with no install and no server round-trip per edit.

## Screenshots
  <!-- ![Structural framing plan](doc/images/structural-plan.png) -->
  ![Architectural floor plan](doc/images/architectural-plan.png)
  <!-- ![2D elevation](doc/images/elevation.png) -->



## Why DraftWorks

- **Local-first drawing** — your drawing lives in the browser's local storage as you work, so closing the browser doesn't lose it. Export to your computer at any time, or import an existing AutoCAD drawing and keep drafting on it right here.
- **No more save headaches** — DraftWorks saves automatically on every change, the way Google Docs does. There's no save button to remember and no "did I save before closing?" moment.
- **A simpler UI for nested commands** — AutoCAD command chains (e.g. `C` → `2P`/`3P` → radius or diameter) live in your muscle memory or nowhere at all. DraftWorks surfaces each step's options directly in the UI, so anyone can complete a command without having memorized the sequence — and every command is reachable the same, consistent way.
- **Proactive setup** — unit setup and dimension setup are asked upfront, not buried in a menu. Tell DraftWorks it's a structural drawing and it sets up production-ready layers for you automatically — beam layer, column layer, beam reinforcement layer, and so on.
- **AI-assisted drafting** — describe what you want to draw — a plot area, a structural element, a pile — and DraftWorks asks the follow-up questions it needs, then drafts the plan for you. Change your mind afterward and it redesigns the drawing to match.

## Features

- **AutoCAD-style drafting workflow** — command line with alias suggestions and history, unit/dimension/paper (MVSETUP) setup prompted when a new drawing starts
- **Precise 2D geometry** — real curves and B-Rep edges under the hood, not approximated sketch lines
- **Snapping & tracking** — object snap, axis/plane snap, point-on-curve snap, and alignment tracking lines
- **Layers** — per-object layer assignment, current-layer workflow, quick move-to-layer
- **Dimensioning** — configurable text height, arrow size, extension offset, and unit-aware precision
- **Undo/redo & transactions** — every edit is transactional and revertible

## Tech stack

| Layer | Technology |
| :--- | :--- |
| Geometry kernel | OCCT (OpenCascade), compiled to WebAssembly |
| Rendering | Three.js |
| Application | TypeScript, npm workspaces monorepo |
| Build | Rspack |
| Testing | Rstest |

See [doc/architecture.md](doc/architecture.md) for how the packages fit together.

## Getting started

```bash
# 1. Install JS dependencies and set up the WASM toolchain (first run only)
npm install
npm run setup:wasm

# 2. Build the WebAssembly geometry kernel
npm run build:wasm

# 3. Run the app in dev mode
npm run dev
```

Other useful scripts:

```bash
npm run build   # production build
npm test        # run the test suite
npm run check   # lint/format with Biome
```

## Project structure

```
packages/
  core     — framework-agnostic interfaces & engine (document model, commands, snapping, undo/redo)
  app      — concrete Application/Document, command implementations
  wasm     — OCCT geometry kernel bindings
  three    — Three.js rendering implementation
  ui       — UI components (ribbon, dialogs, panels)
  element  — low-level DOM element helpers
  storage  — persistence (IndexedDB)
  i18n     — translations
  builder  — composition root wiring everything together
  web      — app entry point
cpp/       — OCCT WebAssembly module source & build
```

## Acknowledgements

DraftWorks is built on top of [Chili3D](https://github.com/xiangechen/chili3d), an excellent open-source browser CAD project by [xiangechen](https://github.com/xiangechen). A large part of this codebase — the OCCT/WebAssembly integration, the core document/command/snapping engine, and the Three.js rendering layer — started from Chili3D and was then adapted and extended toward 2D civil-engineering drafting. Many thanks to the Chili3D authors and contributors.

## License

[AGPL-3.0](LICENSE)
