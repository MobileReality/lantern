# lantern-jira

- Created: 2026-10-27, in the Lantern repo (`skills/lantern-jira/`, the source of truth; the app bundles it)
- Based on: Jira Cloud REST v3 (`/rest/api/3/issue`, `/search/jql`, `/transitions`) and the Atlassian
  Document Format; Node 18 or newer, no dependencies
- Reference: the credentials Lantern injects into agent runs (`ATLASSIAN_EMAIL`, `GLOBAL_ATLASSIAN_TOKEN`,
  `ATLASSIAN_BASE_URL`), and the ones it hands out on request over its local credential socket
  (`scripts/lantern-socket.mjs`, `LANTERN_CREDENTIAL_SOCKET`)

Self-contained: it imports only from its own `scripts/` folder, so it works when copied alone into a
project. A user's own Jira skill takes precedence; Lantern never replaces a skill it did not install.
The user-facing strings are in `scripts/messages.json`.
