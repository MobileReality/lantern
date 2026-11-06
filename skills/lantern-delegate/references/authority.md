# Session authority

The human user's current-session instructions define which mutations are allowed. This skill never expands that authority.

- Do not commit, amend, rebase, or rewrite commits without explicit approval in the current conversation. One approval covers one commit.
- Do not push or create, edit, close, approve, or merge a pull request unless the user explicitly authorized that remote action.
- Respect applicable provider and workspace restrictions. When Atlassian, Rovo, Jira, or another remote is read-only, prepare text locally instead of posting it.
- Keep a worktree that has uncommitted changes. Remove it only after its changes are committed under valid approval, preserved elsewhere, or the user explicitly agrees they are disposable.
- Run only the local mapping, review, verification, commit, publication, and cleanup stages the session authorizes. A later imperative workflow step does not supply missing authority.
