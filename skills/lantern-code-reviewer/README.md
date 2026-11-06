# lantern-code-reviewer

- Created: 2026-09-15
- Based on: `claude 2.1.278` for the harness behaviour below, and this repo's own skill tree as the review rubric.
- **Lantern's own reviewer.** The user extends it with extras in the `reviewer` slot of `~/.claude/lantern-extensions.json` and of the project's `.claude/lantern-extensions.json` (global names first), the way the delegate and the orchestrator are extended. The reviewer agent runs `required-skills.mjs --role reviewer` first and reads every skill it prints in full: `lantern-no-comments`, this skill, and the slot. A skill the user switched off for the reviewer (the off list of the same file) is not printed.
- **The reviewer decides which conventions it needs.** It reads the diff, names the language and stack it sees in the changed files and the project's manifests in one line (manifests such as `package.json`, `go.mod` or `pom.xml` are examples, not a closed list; the extensions are always enough), and uses the convention skills the project has linked that fit.
- **Only `lantern-no-comments` is required, while the reviewer list prints it.** It ships with Lantern. Every other convention is used when the project has it linked. When none fits the language, the verdict's `UNAVAILABLE:` says `no <name or language> convention available`, no other language's rules are applied, and the review goes ahead.
- Reference: what is linked is `ls .claude/skills`.
- Used by: `lantern-delegate` — the mandatory gate between a delegate reporting and its branch being merged.
- Reviews commit messages too, against `lantern-commit`, reading the log with bodies rather than `--oneline`. That convention is the one agents break most often: the session default appends an attribution trailer the skill forbids, so the gate catches what the delegate's own discipline misses.

**Claude Code's built-in review skill** does a generic diff review; this one reviews against the conventions the project has linked. The descriptions keep them apart — if this skill fires when someone wanted the built-in (or the other way round), tune the description.

- Model: **Opus, effort `medium`** — measured, 2026-09-17. A seeded branch carrying 10 planted convention violations (3 line-local, 4 needing convention knowledge, 2 needing whole-file context, 1 in the commit message) was reviewed by three variants from an identical rubric:

  | variant | planted found | latency |
  |---|---|---|
  | opus / medium | **10/10** | 89s |
  | opus / low | 9/10 — missed the `handle*` handler-naming rule | 64s |
  | sonnet / medium | 10/10, but reviewed against 13 conventions instead of 17 | **194s** |

  Sonnet was the *slowest* of the three, which removes the reason to consider it, and it pruned conventions by perceived relevance — the mechanism by which a structural violation ships. Detection barely separated the variants; **severity calibration did**: only opus/medium rated the misplaced sub-component blocking, and in a green loop a non-blocking finding does not gate the merge. Caveat: n=1 per variant on a 57-line diff.

**Ends with four machine-readable lines** (`VERDICT`, `BLOCKING`, `CONVENTIONS`, `UNAVAILABLE`), because a delegate's green loop exits on the verdict and cannot depend on parsing prose. `blocked` covers any review that did not finish — an absence of findings is not a pass, and from outside the two are indistinguishable unless the review says which it is reporting.

**Read-only is meant to be structural.** The skill ships a subagent definition using `disallowedTools: Edit, Write` so the reviewer cannot edit even if it wants to; a rule alone is what gets forgotten forty turns in with an obvious one-line fix on screen. A review spawned by a delegate or orchestrator is run only by that `reviewer` agent: spawned as `general-purpose` the verdict says `UNAVAILABLE: reviewer agent type (running as general-purpose)` and is not green. A review a person asks for in their own session is unaffected.

**Reads what it uses.** Every convention it uses is read from `.claude/skills/<name>/SKILL.md` on disk in full, whether or not the Skill tool can load it.

**Never waits on a question.** Run by a person or spawned by a delegate to judge code that delegate just wrote, it records the conventions it could not use in the verdict and returns, because stopping would hang a delegated run. A `lantern-no-comments` it cannot load yields a **Blocked** verdict. The spawned path is the normal one: see `lantern-delegate`, where the reviewer is the only agent a delegate may spawn, so that scoping, writing and judging land on three different agents.

- Provenance: bundled with Lantern, adapted to Lantern.
