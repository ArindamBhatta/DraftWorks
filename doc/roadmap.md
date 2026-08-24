# 2D CAD Learning Tool — MVP Roadmap

## Goal

Not an AutoCAD clone. A **2D drafting tool with familiar CAD conventions, for students
learning CAD.** The whole product experience is:

> Open the URL → pick your preferred units, a starting dimension style, and a starting
> layer → start drawing on a locked 2D plane.

That's it. Everything else in Chili3D that isn't in service of that flow is out of scope
for this roadmap (see [Non-goals](#non-goals)).

> Related docs: [`architecture.md`](./architecture.md) describes the general codebase
> this is built on; [`2d-clone-roadmap.md`](./2d-clone-roadmap.md) audits the separate,
> already-in-progress effort to lock the viewport/workplane to 2D, which this roadmap
> depends on but doesn't duplicate.

---

## What already works (verified against the codebase, not assumed)

Chili3D is a real, running parametric CAD app, not a scaffold. For this goal, that means
the following are **already done** and don't belong in a task list:

- Drawing primitives: `line`, `circle`, `rect`, `ellipse`, `regularPolygon`, `arc`
  (3 modes), `point`, `polygon` — `packages/app/src/bodys/` + `packages/app/src/commands/create/`.
- Editing: `move`, `rotate`, `mirror`, `array`, `trim`, `split`, `break`, `fillet`,
  `chamfer`, `offset`, `delete` — `packages/app/src/commands/modify/`.
- The ribbon (`packages/builder/src/ribbon.ts`) is already trimmed down to roughly this
  set — this isn't a future task, it's current state on this branch.
- Undo/redo, save/load (IndexedDB via `packages/storage`), the property panel, the
  project tree, snapping (`packages/core/src/snap/`) all work today.
- `UnitSetup` (`packages/core/src/foundation/unitSetup.ts`) already implements
  Architectural/Engineering/Decimal/Fractional/Scientific length formatting and parsing.
- The 2D viewport/camera/workplane lock is in progress separately — see
  [`2d-clone-roadmap.md`](./2d-clone-roadmap.md).

I checked specifically and confirmed these **do not exist yet** — they are the real gap
between what's here and the goal above:

- No first-run setup/onboarding flow of any kind.
- No layer concept in the document model at all (`packages/core/src/model/` has no
  `LayerNode`/layer table; shapes only have color/material, no on/off or current-layer).
- No dimension/annotation entity. `packages/core/src/snap/dimension.ts` is a false
  friend — it's an internal bitmask for which axes a snap step measures, not a drawable
  linear/aligned dimension.
- `UnitSetup` isn't wired into the live drawing input path yet (tracked in
  [`2d-clone-roadmap.md`](./2d-clone-roadmap.md) gap #1).

---

## The MVP: four pieces

### 1. Finish wiring `UnitSetup` into live input

Do this first — the other three pieces are more useful once numbers on screen are
correct, and this is the smallest, most self-contained piece.

- `packages/core/src/snap/handlers/snapEventHandler.ts` — `formatSnapDistance()`
  currently does `num.toFixed(2)`. Swap in `UnitSetup.formatLength(num)`; every snap
  handler shares this base method, so this one edit fixes tooltips everywhere.
- `packages/core/src/snap/handlers/lengthSnapEventHandler.ts` and
  `pointSnapEventHandler.ts` — replace raw `Number(text)` parsing of typed lengths with
  `UnitSetup.parseLength(text)`. Skip this for the handful of `getPointFromInput` cases
  that parse a 0–1 curve parameter, not a real-world length.
- Add `UnitSetup.isValidLength(text): boolean` — `parseLength` currently returns `0` for
  unparseable input instead of signaling failure, so bad typed input is silently
  accepted as "0" today.

### 2. First-run setup wizard

A dialog shown before the first drawing opens (and reachable later from a settings
command, for changing your mind mid-session):

- **Units** — which `UnitSetup` format + precision to use. This is the only piece with
  real logic behind it already (piece 1).
- **Starting dimension style** — bare minimum to draw with: text height, arrow size.
  Not a `DIMSTYLE` table, just two numbers fed into piece 4's defaults.
- **Starting layer** — a name and a color for layer `0`, created via piece 3.
- Persist the choice (IndexedDB, alongside the document, via `packages/storage`) so a
  returning student doesn't see the wizard every time unless they ask to change it.
- Build as a `packages/ui/src/dialog.ts`-based component; hook into
  `Application.newDocument()` (`packages/app/src/application.ts`) so it runs before a
  blank document is handed to the user.

### 3. Minimal layer model

Just enough to teach the ByLayer concept — not the full AutoCAD Layer Table:

- A `LayerNode`/layer collection in `packages/core/src/model/`, following the existing
  `Node`/`FolderNode` pattern (`@serializable()`, `INodeLinkedList` where relevant).
- Fields: name, color, visible, current (active layer new shapes are drawn on).
- `ByLayer` resolution: a shape without its own explicit color resolves to its layer's
  color, building on the existing `packages/core/src/material.ts` handling.
- A compact layer switcher in the ribbon or status bar (name + color swatch +
  visibility toggle) — not a full `LAYER` dialog with Freeze/Lock/Plot/linetypes.

**Explicitly deferred, not part of MVP:** linetypes/`LTSCALE`, lineweights, ACI 1–255
color table, `LAYISO`/`LAYFRZ`/`LAYLCK` family, Freeze/Lock/Plot flags.

### 4. Basic dimension entities

Enough for a student to label a drawing:

- `DimLinearNode` and `DimAlignedNode` as `ParameterShapeNode` subclasses in
  `packages/app/src/bodys/`, following the existing body-node pattern
  (`generateShape(): Result<IShape>`).
- Commands under `packages/app/src/commands/create/` built on the existing
  `core/src/step/pointStep.ts` input pattern (pick two points, place the dimension
  line).
- Reuse `packages/core/src/model/annotation.ts` +
  `packages/three/src/threeAnnotation.ts` for the dimension text — that rendering
  path already exists for other annotations.
- Text height / arrow size default from piece 2's setup wizard.

**Explicitly deferred, not part of MVP:** a `DIMSTYLE` table/dialog, angular/radius/
diameter/ordinate dimensions, live associativity (auto-updating when geometry is
edited later), `DIMCONTINUE`/`DIMBASELINE` chains, multileaders.

---

## Suggested order

1. **Unit wiring** (piece 1) — small, self-contained, makes everything after it show
   correct numbers.
2. **Layer model** (piece 3) — mostly independent of the others; needed before the
   wizard can offer a real "starting layer" step.
3. **Setup wizard** (piece 2) — ties units + layer together into the actual first-run
   experience described in the goal.
4. **Dimensions** (piece 4) — benefits from units already being wired in and the wizard
   existing to seed default text height/arrow size.

## Non-goals

Everything below was in an earlier, much larger draft of this roadmap aimed at full
AutoCAD 2011/2013 parity. None of it serves the stated goal (a URL a student opens to
set preferences and start drawing) and none of it is planned:

AutoCAD-alias command line + autocomplete, dynamic input HUD, multi-function hot grips,
window/crossing selection styling, full linetype/lineweight engine, `LWPOLYLINE` bulge/
width editing, `SPLINE`, `XLINE`/`RAY`, `HATCH` pattern + boundary-loop engine, `DONUT`/
`REVCLOUD`, `STRETCH`, quick trim/extend, polyline `JOIN`/`PEDIT`, `ALIGN`, `LENGTHEN`,
full 13-mode OSNAP + Polar Tracking + OTRACK, `DIMSTYLE` table and the full dimension
family, `MTEXT` rich editor, multileaders, annotation scaling, Blocks/`INSERT`/
attributes/`BEDIT`/`WBLOCK`, XRefs, DXF/DWG read-write, Paper Space layouts, `MVIEW`
viewports, `PLOT`/`CTB` pen tables, vector PDF/SVG export.

If any of these turn out to be genuinely needed later, scope them as a new roadmap
against the actual need at the time — don't resurrect this list wholesale.

## Definition of done

The MVP is complete when a student can:

1. Open the app URL and, on first run, choose a unit system/precision, a starting
   dimension style, and a starting layer before seeing a blank drawing.
2. Draw and edit using the existing 2D primitive/modify command set, with correctly
   formatted units shown live (typed input and on-screen tooltips agree).
3. Create a second layer, switch the current layer, and see new shapes inherit its
   color by default.
4. Place a linear and an aligned dimension on their drawing and have it render with
   the text height/arrow size chosen at setup.
