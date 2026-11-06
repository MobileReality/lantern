# Handoff

Plan unreviewed (unattended run). Reviewer verdict: merge-with-followups, BLOCKING 0.

Non-blocking follow-ups from the reviewer:
- `run()` in `lantern-host-status.ts` resolves the origin whenever a project has any record, and clears cached answers when the origin cannot be read once. Resolve only when there are ids to ask and keep the cache on a failed read.
- `recordBelongsTo` checks the provider only, not the owner and repository of a record URL.
- No test covers the cap of 30 non-open lookups.
- Taste: define the rate-limited marker beside `HostAnswer` so the status module does not import the GitHub module.
