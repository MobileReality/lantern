# Plan: Guide view in the PR review screen (LAN-122, s3.2)

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | lanternguide.ts (pure helpers), lanternguideview.ts (DOM view), lantern-guide.css | todo | |
| 2 | Wire Guide into lanternview.ts and the view bar (lanternmacroview.ts) | todo | |
| 3 | Demo fixture guide, harness param, demo script | todo | |
| 4 | e2e spec pr-review-guide + jsdom unit test | todo | |
| 5 | Lantern map + PR record | todo | |

## Validation

- `pnpm test`
- `pnpm run typecheck`
- `pnpm run test:pr-review:e2e`
- `pnpm run test:graph:e2e`

## Non-goals

Files mode, per-file explainer, Flow view, comments, guide grammar and parsers, skills/, scripts/e2e-delegate, scripts/skill-test.

## Decisions

- Guide is a view of the view bar beside Files, Macro and Flow; it replaces the graph host like Flow.
- A PR with no guide shows no Guide button; one with a `guideError` shows it disabled with the error as its title.
- The demo guide is attached by the harness only with `?guide=demo` so the other specs keep opening in Files.
