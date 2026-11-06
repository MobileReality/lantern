# demo-sections

- Created: 2026-11-06
- Based on: `lantern 1` map format, the Sections chapter of `references/format.md`
- Reference: none — a fictional online bookshop invented to show the four project sections

**Fictional, but complete.** The source files are here and `.lantern/` is a settled map of them:
`node scripts/validate.mjs example-web/demo-sections --settled` exits 0 (8 files, 4 sections). The
company, people, addresses and code are made up; no real system is described.

**What the fixture shows**

- `rbac`: three roles, four endpoints, a 3 x 4 matrix with one `cond` cell, where roles come from
  and the one guard that enforces them.
- `states`: the order machine, one initial state, two terminal ones and the four transitions with
  the function that performs each.
- `db`: three tables read off one migration, so every entity and field is `declared`, with two
  foreign keys and the repository that owns each table.
- `facts`: two things the code does that a reader would not guess.

Rendered to `../demo-sections.html` (`render.mjs`, see the skill's `README.md`).
