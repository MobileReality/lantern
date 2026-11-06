# Lantern graph performance

> Historical SVG baseline. The current architecture graph uses Pixi/WebGL; these figures describe the earlier SVG implementation.

Why the Lantern graph is slow on a map with thousands of relations, measured on `main` (5ac1a84), and which fix to do first.

## How it was measured

- **Map:** the real `nft-reality-platform` `.lantern`: 2,886 records, 7,768 relations (3,269 `<`, 2,793 `>`, 1,706 `=`; 329 point outside the repo), 1,249 map files, 5 platform tabs plus Shared. The whole project (1.2 GB, without `node_modules`, `.git`, `dist`, `build`, `.next`) was copied to scratch and opened there; the real project was never opened or written. Node counts below exceed record counts because boundary and external boxes are nodes too.
- **App:** a patched copy of a fresh `pnpm compile` build (own ports, user-data dir and HOME, scan/notifier/mic stubbed), timers around the load phases (main) and around layout, columns, edges, nodes and side panel (renderer), driven through the debug `/eval` route. CDP `Performance.getMetrics` gave script/style/layout, CDP `Tracing` gave paint, raster and GPU. Prototypes are flags in that copy only; nothing here is in the repo.
- **Machine:** Apple M3 Pro (11 cores, 19 GB), macOS 26.5.1, Electron 33.4.11, window 1500x950 at DPR 1, normal desktop load (the user's Lantern, VS Code and Slack open, load average about 3), `caffeinate` on.
- **Method:** medians of 5 runs (load and mount 3; scroll 3 sweeps of 60 steps of 90 px). "To frame" = action until the second `requestAnimationFrame` after it; idle floor 33 ms. All and Web rows are medians of three fresh launches (All tab switch 303, 283, 284 ms; hover 239, 209, 216; select 273, 252, 299; Web scroll p95 353, 392, 541), the other rows of one or two launches. Mount also drifts by up to about 35% (281 vs 383 ms for the same build; a step in layout time from about 50 to 145 ms that can hit mid-session), so prototypes are compared only with a baseline measured in the same state and the plan re-measures with baseline and change interleaved.

## Before (ms unless noted)

| Tab | Nodes | Edges | SVG elements | Mount | Hover | Select | Filter toggle | Key in search | Scroll p95 |
|---|---|---|---|---|---|---|---|---|---|
| All | 2,971 | 7,768 | 33,241 | 284 | 216 | 273 | 250 | 83 | 515 |
| Web | 1,732 | 4,362 | 19,299 | 167 | 122 | 162 | 166 | 67 | 392 |
| API | 1,338 | 3,051 | 13,259 | 134 | 109 | 121 | 131 | 52 | 96 |
| Slack bot | 162 | 362 | 1,646 | 49 | 34 | 34 | 33 | 33 | 18 |
| Teams, Infra, Shared | 18-66 | 11-97 | 140-575 | 33 | 33 | 33 | 33 | 33 | 18 |

DOM: 37,491 elements on All (3,935 in the side panel). Memory is not the problem: renderer 317 MB on a tiny tab, 405-447 MB on the big tabs, GPU 91 to 155 MB, JS heap 15 MB.

**Load (main process; the 2.8 MB payload is the same for every tab):** `JSON.stringify` 5-7 ms, IPC overhead about 35 ms. Warm `lantern:load` median 549 ms: read and parse 1,249 map files 200, source enumeration 141, lang texts and features 170, stat 14, PR records 15. First load after launch 1.2, 2.1 and 2.9 s on three launches, of which enumeration 540-745 ms and lang texts 455-1,690 ms; the tab open and the window-focus handler both call `lantern:load`, so two loads run at once. Reopening Lantern on All: 930 ms to the first frame (load 620 plus mount).

**Where the time goes on All (Tracing):**

| Action | Script | Style | Layout | Paint+layerize+commit | Compositor thread | GPU |
|---|---|---|---|---|---|---|
| Mount (per tab switch) | 252 | 80 | 65 | 25 | 5 | 178 |
| Hover in+out (3 pairs) | 105 | 618 | 12 | 290 | 1,730 | 1,026 |
| Scroll (180 frames) | 5 | 0 | 0 | 2,079 | 624 | 25,334 |

Mount script is 252 ms: graph build 82 (layout 10, columns 12, edge paths 3, path elements 14, arrowheads 3, titles 6, nodes 24, listeners 4), side panel 24, forced reflow from `side.scrollTop` about 117, the rest 29. JS is not the bottleneck. The cost is the browser restyling all 7,768 edges on every hover and select (each also runs a 0.12 s opacity transition on the compositor) and rastering 7,768 long strokes with arrowhead markers on every scroll.

## Scenarios, ranked by gain per effort (prototypes on All, N=5-7, same-session baselines)

| # | Scenario | Measured gain | Effort | Risk | What the user sees |
|---|---|---|---|---|---|
| 1 | Remove the opacity transition on `.lt-edge`/`.lt-node` | hover 220 to 67, select 252 to 154; Web hover 125 to 50 | S | S | Dimming is instant, no 0.12 s fade |
| 2 | Focus without per-edge DOM writes: edges indexed by node, dim via one class on the layer, markers only on hot edges (with 1) | hover 67 to 50, select 154 to 100, `focusOn` 8 to 0.6 ms | S | S | Same |
| 3 | Draw only the hovered/selected node's edges, plus a dim bundled hint (first edge per pair of depth-3 directories, 403 paths) | scroll p95 490 to 18, hover 227 to 50, select 360 to 167-183, mount 383 to 300, SVG 33k to 18.5k, hover GPU 1,026 to 186; Web scroll p95 339 to 17 | M | M | Overview is bundles, not every line; real bundles need aggregated geometry and a tooltip story |
| 4 | Skip redraw and reload when nothing changed (window focus) | window focus on All (a dispatched `focus` event, 5 runs) blocks the main thread 308 ms and starts a 0.5 s load each time | S | S | None |
| 5 | Debounce search; update only the changed side-panel block | `service` typed on All is about 815 ms of redraws (83 ms per key, 233 first); `drawSide` is 24-33 ms of every select | S | S | Results after a short pause |
| 6 | Load path: parse cache keyed by mtime, enumeration and lang texts after the first payload, one load at a time | not prototyped; removable from the critical path: enumerate + lang texts = 311 of 549 ms warm, 1.0-2.4 s of the 1.2-2.9 s cold | M | S | Faster open; "unmapped" count arrives a moment later |

### Decision on scenario 3 (product owner)

Relations are drawn only after the user **clicks** an element. By default the graph shows nodes and no relation lines: no bundled hint, and hover does not draw relations (it may highlight the node itself). Reason: all relations at once are not readable, so the overview gains nothing from drawing them.

What changes in this document:

- Scenario 3 becomes **click-to-reveal**: effort S and risk S, because the aggregated bundle geometry, its tooltip and the "first edge per directory pair" hint are dropped.
- Expected gain is at least the prototype's, since the prototype still drew 403 hint paths and this draws none by default: SVG elements on All fall to roughly the node and column count. This is an expectation, to be confirmed by the harness in plan step 2; it is not a measurement.
- The first version's scenarios 6 (arrowheads only on hot edges) and 7 (hide external edges by default) are cut: with click-to-reveal only the clicked element's edges exist, so every drawn edge can keep its arrowhead and external edges appear only with them. The platform-tab default is also cut, so the load path is now scenario 6.
- Scenarios 1 and 2 still matter for the click and the dim/highlight of the clicked element; scenarios 4, 5 and 6 are unaffected.

**Dropped, with numbers:** Canvas 2D for edges (1,698 of 7,768 long curves intersect the first viewport; redraw about 100 ms per frame, scroll p50 102 ms vs 58 for SVG, 565 ms for a full draw); viewport virtualisation and `content-visibility` (not available for SVG children; node windowing is at most the node share of mount, revisit after 3); Web Worker or main-process graph preparation (layout 10, edge paths 3, index 2 ms: about 5% of mount); event delegation (listeners 4.4 ms); removing edge `<title>` (-6 ms, no hover or scroll gain, goes away with 3); filtering type-only imports (the map has no such marker, 94% of relations carry a `#symbol`: needs a format change).

## Recommended plan

1. **Scenarios 1 and 2** (one small PR). Verify: All hover at most 55 ms (from 216), select at most 120 (from 273), Web hover at most 55 (from 122), `focusOn` under 1 ms.
2. **Scenario 3 as decided: relations only after a click, none by default.** Verify: All and Web scroll p95 at most 20 ms (from 515 and 392), SVG elements on All under 20,000 (from 33,241), hover GPU under 250 ms (from 1,026), All mount no worse than the same-session baseline (prototype: -22%).
3. **Scenarios 4 and 5.** Verify: a window focus on All costs under 20 ms of main-thread time (from 308) and starts no load when the map is unchanged; typing `service` on All is one redraw, under 250 ms in total (from about 815).
4. **Scenario 6.** Verify: warm `lantern:load` at most 300 ms (from 549), first load after launch under 800 ms (from 1.2-2.9 s), one load per tab open.
5. **Re-measure, then decide on node windowing.** Window the nodes only if Web mount stays above 150 ms or a filter toggle above 100 ms (now 167 and 166).

Each step is verified by re-running the same harness (patched copy, same project copy, same machine state) and comparing the numbers named above; a figure that moves less than half of the stated gain is a failed step.

## Result of plan step 2 (click-to-reveal)

Same harness and project copy, base (`chore/graph-dim-class`, scenarios 1 and 2) against the change, two launches each, interleaved, medians of 5 (scroll: 3 sweeps of 60 steps of 90 px). Machine load average was 5-13 during the runs, so read the mount and click rows as indicative.

| Metric | Base | Change | Target |
|---|---|---|---|
| All scroll p95 | 633 / 543 ms | 17.5 / 17.2 ms | at most 20 |
| Web scroll p95 | 582 / 547 ms | 17.5 / 17.1 ms | at most 20 |
| SVG elements on All | 33,241 | 17,705 | under 20,000 |
| Hover GPU (3 in+out pairs, All) | 1,121 ms | 0 (no GPU task) | under 250 |
| All mount (tab switch to frame) | 249 / 250 ms | 183 / 167 ms | no worse |
| Web mount | 150 / 150 ms | 117 / 101 ms | no worse |
| All hover to frame | 50 ms | 33 ms (idle floor; nothing is drawn) | - |
| All click (170 edges) to frame | 83-100 ms | 83-100 ms | - |

## Status: implemented

All planned scenarios are merged (the platform-tab default was cut). Numbers are from each PR's own harness run on a copy of the project, medians, machine under load.

| Step | PR | Result | Target |
|---|---|---|---|
| 1. Scenarios 1 and 2: no fade, one dim class, edges indexed by node | #49 | All hover 210 to 50 ms, All select 263 to 83-100, Web hover 133 to 33-50, `focusOn` 8.3 to 0.5-0.9 | 55 / 120 / 55 / under 1: met (one of five All-hover launches read 66.5) |
| 2. Scenario 3: relations only after a click | #51 | see the section above | met |
| 3. Scenarios 4 and 5: skip reload on unchanged focus, debounced search | #52 | window focus 223-231 to 22-24 ms with no load and no redraw; `service` typed: 7 redraws to 1, 601-732 to 208-253 ms | under 20 / under 250: focus missed by about 4 ms (6-9 ms is the hub and review focus listeners, not Lantern), typing met with little margin |
| 4. Scenario 6: load path | #50 | warm `lantern:load` about 530 to 66-74 ms, first load after launch 836-940 to 134-168 ms, one build per tab open (the renderer still sends two IPC calls, the second joins the first or is a warm 66-90 ms build) | 300 / 800 / one: met |

Behaviour decided on the way:

- `lantern:load` returns the graph first; the unmapped-file coverage arrives later through `lantern:coverage`. Parsed files are cached in RAM by path, mtime and size; a caller with `fresh` (files changed, agent finished, PR fetched) queues exactly one trailing build. There is no disk cache.
- Window focus compares a stamp (mtime and size of `.lantern/` and the git refs) and reloads only when it differs, or when the last load is over 5 minutes old, because source files are not in the stamp.
- Search redraws the graph once, 200 ms after the last key, and swaps only the stats block; a selected node that the search hides stays in the detail pane until the next full refresh.

Open: step 5 (re-measure, then decide on node windowing) has not been run on the merged build. Non-blocking review notes: `lanternview.ts`, `lantern.ts` and `features/lantern.ts` are over the 300-line guideline; `loadPrs` is still in the first load stage on projects with a git origin and was not measured.

## Relation view

A toggle (top right of the graph once a file is selected, and a button in the side panel detail) redraws the graph as the selected file and its direct relations only: files it takes from on the left, files it sends into on the right, both-way files in a group above, and the file itself in the middle with an arrowed edge to each neighbour. A side with no files is dropped, so a file that takes from nothing sits at the far left and one that gives nothing at the far right. Long lists wrap into up to three sub-columns, grouped by directory (the group above may use up to six).

Choices: filters, search and the platform tab apply to the neighbours (a neighbour they hide is not drawn); pull request mode keeps its tint on the cards; a neighbour on another platform is a boundary card and a click on it switches platform and re-centres; a click on any neighbour re-centres with a move of 240 ms (instant under `prefers-reduced-motion`); Esc or the toggle leaves, keeping the currently centred file selected; a filter or search that hides the centred file also leaves the view (the normal graph is drawn and it does not come back by itself); a click on empty space does nothing in this view. The hint "Many relations in X" appears in the side panel at 25 or more related files in one column (`DENSE_COLUMN_RELATIONS`), is dismissed for the rest of the session with the cross, and is not shown in pull request mode (that panel replaces the detail).

Measured on the copy of the project (All tab, `client/index.ts`, 170 relations: 3 sent, 166 both ways), medians of 6, machine under load:

| Case | Result |
|---|---|
| Enter the view | 85 ms script, 94 ms to frame; 1274 SVG elements (170 cards, 169 edges), page DOM 6402 instead of 21967 |
| Re-centre on a neighbour (16 cards) | 70 ms script, longest animation 240 ms |
| Leave the view | about 150 ms (the normal graph is drawn again, as on a filter change) |
| Normal graph, All scroll p95 | 17.3 ms (lift branch 17.6 ms) |
| Normal graph, click to frame | 116 ms (lift branch 117 ms, same session); still no edges in the DOM until a click |
