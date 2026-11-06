# Session authority

The human user's instructions in the current conversation define which mutations are allowed. Mapping or delegation never expands that authority.

- Do not commit, amend, rebase, or rewrite commits without explicit approval in the current conversation. One approval covers one commit.
- Do not push or create, edit, close, approve, or merge a pull request unless the user explicitly authorized that remote action.
- Atlassian, Rovo, Jira, and Bitbucket-hosted planning resources are read-only when the user's rules say so. Prepare text locally for the user instead of posting it.
- Keep an uncommitted worktree. Inspect and report its paths; remove it only after its changes are committed under valid approval, safely preserved elsewhere, or the user explicitly agrees they are disposable.
- Run only the local mapping, review, verification, commit, publication, and cleanup stages that the session authorizes. A later imperative workflow step does not supply missing authority.
