# Contributing to DraftWorks

Thanks for taking a look. DraftWorks is a 2D CAD drafting app that runs in a browser tab, built for civil engineers who draft for a living. Most of it is TypeScript. You don't need to know AutoCAD to help, though it helps to know that AutoCAD's behaviour is the specification here: if a command behaves differently from AutoCAD without a good reason, that's a bug.

There are useful contributions at every size: bug reports with a DWG attached, translations, docs, new commands and geometry work. A list of ready-to-pick problems is [further down](#problems-to-pick-up).

---

## Get it running in five minutes

You need **Node.js 20.19+ or 22.12+** and git.

```bash
git clone https://github.com/ArindamBhatta/DraftWorks.git
cd DraftWorks
npm install
npm run dev
```

Open the URL rspack prints. That's it.

**You do not need Emscripten or a C++ toolchain.** The compiled geometry kernel (OCCT) and the DWG converter (LibreDWG) are committed as WebAssembly in [packages/wasm/lib/](packages/wasm/lib/). You only need `npm run setup:wasm` and `npm run build:wasm` if you are changing the C++ in [cpp/](cpp/), and that build takes a while.

### Before you open a pull request

```bash
npm test          # ~850 tests, about 10 seconds
npm run check     # Biome lint + format, fixes what it can
npm run build     # production build, also runs the TypeScript checker
```

`npm install` sets up a pre-commit hook that runs Biome on your staged files, so formatting is mostly handled for you.

---

## Where things live

The code is a set of workspace packages under [packages/](packages/). The short version:

| Package | What's in it |
| :--- | :--- |
| `core` | Interfaces and engine: document tree, undo/redo, snapping, command infrastructure, maths, unit formatting. No DOM, no Three.js, no WASM. |
| `app` | The real application: every command (`src/commands/`), every shape (`src/bodys/`), DXF/DWG/plot I/O (`src/io/`). |
| `ui` | Web Components for the window, ribbon, command line, layer and property panels. |
| `three` | Rendering with Three.js. |
| `wasm` | TypeScript bindings to the OCCT kernel, and the committed `.wasm` builds. |
| `ai` | The AI panel's conversation, question routing and Claude/Gemini providers. |
| `generators` | Parametric drawing generators the AI panel uses (floor plans, elevations). |
| `i18n` | UI text. Only English so far. |
| `builder` | Wires everything together, and defines the ribbon layout. |
| `web` | The HTML entry point. |

[doc/architecture.md](doc/architecture.md) explains the patterns in more depth. Its package graph and patterns section are accurate; some folder listings are out of date (see [problem 6](#6-bring-docarchitecturemd-up-to-date)).

### Adding a command

This is the most common kind of contribution. Take POINT as the smallest real example, [packages/app/src/commands/create/point.ts](packages/app/src/commands/create/point.ts):

1. **Write the command** in `packages/app/src/commands/<group>/`. Decorate it with `@command({ key: "create.point", icon: ... })`. Extend `CreateCommand` if it draws something, or `MultiStepCommand` if it doesn't (see [refSegment.ts](packages/app/src/commands/create/refSegment.ts)). Export it from that folder's `index.ts`.
2. **Register the name.** Add `"command.<your.key>"` to [packages/core/src/i18n/keys.ts](packages/core/src/i18n/keys.ts) and its English text to [packages/i18n/src/en.ts](packages/i18n/src/en.ts). Prompts and messages go in the same two files. TypeScript will refuse to build if either is missing.
3. **Give it AutoCAD's alias** in [packages/core/src/command/commandAliases.ts](packages/core/src/command/commandAliases.ts), so `di` runs DIST the way it does in AutoCAD.
4. **Put it on the ribbon** (optional) in [packages/builder/src/ribbon.ts](packages/builder/src/ribbon.ts).
5. **Test it.** Tests sit next to the source as `*.test.ts`. They don't boot the WASM kernel, so pull the geometry maths into a plain exported function and test that; [circle.test.ts](packages/app/src/commands/create/circle.test.ts) shows the pattern.

---

## Conventions

- **Match AutoCAD.** Use the same aliases, prompt wording and option letters (`[3P/2P]`). People arrive with muscle memory; don't make them relearn.
- **Geometry failures are values, not exceptions.** Anything that calls the kernel returns `Result<T>` (`Result.ok` / `Result.err`). Degenerate geometry is expected input.
- **`Matrix4` is row-vector.** `A.multiply(B)` applies **A first**. That's the opposite of most 3D libraries. To pivot about a point: `fromTranslation(-p).multiply(op).multiply(fromTranslation(p))`. Test pivots with "the pivot point must not move".
- **Transient UI floats and expires.** Prompts and history messages float over the canvas and fade out. Only what the user is answering right now gets permanent space. See [commandHistory.ts](packages/ui/src/commandLine/commandHistory.ts).
- **No license header in new files.** Many files still carry the two-line Chili3d header from upstream. Don't copy it into new ones; start with your imports.
- **Comments explain why.** The existing code explains decisions, not mechanics. Match that.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(dimension): add DIMCONTINUE`, `fix(trim): ...`.

---

## Problems to pick up

Comment on the matching issue (or open one) to say you're taking a problem, so two people don't build the same thing. Each problem below says where to start.

### Good first issues: a few hours, no CAD maths

#### 1. Save the plot as SVG

PLOT only writes PDF, but the live preview is already a complete SVG of the sheet from `plotToSvg`. Add an output-format choice to the plot dialog and save that SVG.
**Start:** [packages/app/src/commands/plot.ts](packages/app/src/commands/plot.ts) (the preview is built around line 253), [packages/app/src/io/plot/plotSvg.ts](packages/app/src/io/plot/plotSvg.ts).

#### 2. Add a ZOOM command (`z`)

There's no ZOOM command yet. `cameraController.fitContent()` already does what ZOOM Extents does. Start with `Z` → `E`, then add Window.
**Start:** [packages/app/src/commands/view/pan.ts](packages/app/src/commands/view/pan.ts) as a template, [packages/core/src/visual/cameraController.ts](packages/core/src/visual/cameraController.ts).

#### 3. Translate DraftWorks into your language

Only English exists. Copy [packages/i18n/src/en.ts](packages/i18n/src/en.ts) to `<code>.ts`, translate it, and export it from [packages/i18n/src/index.ts](packages/i18n/src/index.ts). The `Locale` type requires every key, so the build lists any you've missed. Keep CAD terms the way drafters in your language say them. They often use the English words.

#### 4. Match the browser language by its primary subtag

`I18n.defaultLanguage()` compares `navigator.language` exactly, so a browser set to `hi-IN` won't pick up a `hi` translation. Fall back to the part before the hyphen, and add a test.
**Start:** [packages/core/src/i18n/i18n.ts](packages/core/src/i18n/i18n.ts), line 40.

#### 5. Run tests and lint on pull requests

The only GitHub workflow deploys Pages on pushes to `main`. Nothing checks a pull request. Add `.github/workflows/ci.yml` that runs `npm ci`, `npm test` and `npx biome ci` on Node 22.

#### 6. Bring doc/architecture.md up to date

It describes a `commands/measure/` folder and zh-cn/pt-br/ru locales that no longer exist, leaves out the `ai` and `generators` packages, and sends readers to `CLAUDE.md` for build commands, which points at a file that isn't in the repo.

### Medium: a new command following an existing one

#### 7. DIST (`di`)

Pick two points. Report the distance, ΔX, ΔY and angle in the drawing's own units (`5'-8 1/2"`, not `1739.9`), as a toast.
**Start:** `MultiStepCommand` with two `PointStep`s. Format with `UnitSetup` in [packages/core/src/foundation/unitSetup/unitSetup.ts](packages/core/src/foundation/unitSetup/unitSetup.ts).

#### 8. AREA (`aa`)

Pick points, or pick a closed object. Report the area and perimeter. Engineers use this constantly for slab, plot and room areas.

#### 9. DIMCONTINUE (`dco`) and DIMBASELINE (`dba`)

Continue a chain of dimensions from the last linear dimension, or measure each one from a common baseline. Almost every structural drawing needs these.
**Start:** [packages/app/src/commands/dimension/](packages/app/src/commands/dimension/).

#### 10. DIVIDE (`div`) and MEASURE (`me`)

Place points along a curve at N equal segments, or at a fixed length. This is how rebar and stirrups get spaced.

#### 11. LENGTHEN (`len`)

Delta, Percent, Total and Dynamic, as in AutoCAD.

### Harder: geometry work (open an issue with your approach first)

#### 12. Circle Tan-Tan-Radius and Tan-Tan-Tan

Both are on the ribbon but greyed out because the tangent solve isn't written yet. The solve needs line/line, line/circle and circle/circle cases, and the maths should be a pure function with tests, like `circumcircle`.
**Start:** [packages/app/src/commands/create/circle.ts](packages/app/src/commands/create/circle.ts), [packages/builder/src/ribbon.ts](packages/builder/src/ribbon.ts) around line 19.

#### 13. PNG export

Rasterise the plot SVG at a chosen DPI. This builds on problem 1.

#### 14. Blocks (BLOCK / INSERT)

This is the biggest missing feature. It needs a block table in the document, insert nodes, serialisation, and a DXF/DWG round trip. Please discuss the design in an issue before writing code.

---

## Reporting a bug

[Open an issue](https://github.com/ArindamBhatta/DraftWorks/issues) with:

- what you did, what you expected, and what happened
- your browser and OS
- **the file**, if it involves import, export or plotting. A DWG that won't open is only fixable with the DWG. DraftWorks never uploads your drawings, so nothing is shared unless you attach it.

## Pull requests

- Fork, branch from `main`, and open the PR against `main`.
- Keep a PR to one thing. Two small PRs get merged faster than one large one.
- For anything visible, add a screenshot or a short GIF.
- Say which problem or issue it closes.

## License

DraftWorks is [AGPL-3.0](LICENSE). By contributing, you agree that your contribution is licensed the same way.
