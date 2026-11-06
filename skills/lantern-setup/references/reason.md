# Why: the sentence under a changed file

The reason recorded for a changed file, in a pull request record (`#reason <path> <reason>`) or in a
local comparison, follows three rules. The Lantern app's "Write reasons" run carries the same three
in `src/shared/reason.ts`, and a test keeps that copy equal to this list.

- One sentence saying why the change was made in that file, not what changed: the reviewer already sees the diff.
- Good: "Rejects a negative pid before it reaches kill()". Never: "Changed the guard".
- At most 160 characters, plain text: no markup, no newlines.

Lockfiles, assets and generated files get a default sentence from `lantern-sync`; every other
changed file needs its own.
