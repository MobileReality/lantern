# Plan: pull request declined state

Goal: a pull request closed without a merge stays in Lantern as declined, on Bitbucket and GitHub.

## Cause found

- The PR record lives only on the PR branch. A declined PR never merges, and `fetch --prune` drops the
  branch once it is deleted, so the PR vanished from the load.
- Bitbucket only asked the host about git-open PRs, so a git-closed one was never confirmed declined or merged.
- The strip hid a non-open, non-merged PR two days after it was opened, not after it was declined.
- Hover card badge said `closed` where the strip says declined.

## Tasks

| # | Step | Status |
|---|---|---|
| 1 | Remember remote records, keep vanished ones as closed with closedAt | done |
| 2 | Bitbucket asks the host about closed PRs | done |
| 3 | Strip counts declined from decline time; badge reads declined | done |
| 4 | Tests per host, update the two tests that pinned the old behaviour | done |

## Validation

- `pnpm run typecheck`
- `pnpm test`

## Non-goals

Windows installer files, `.lantern/plans/`, new PR actions, `docs/primitives.md`.
