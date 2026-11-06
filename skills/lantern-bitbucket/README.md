# lantern-bitbucket

- Created: 2026-10-27, in the Lantern repo (`skills/lantern-bitbucket/`, the source of truth; the app bundles it)
- Based on: the Bitbucket Cloud REST API 2.0 (`/repositories/{workspace}/{repo}/pullrequests`) and the
  remote parsing and pull-request create approach of `lantern-delegate`'s former per-host `pr-create.mjs`
  (copied, not imported: a skill may import only from its own folder); Node 18 or newer, no dependencies
- Reference: the credentials Lantern injects into agent runs (`BITBUCKET_EMAIL`, `BITBUCKET_API_TOKEN`), and
  the ones it hands out on request over its local credential socket (`scripts/lantern-socket.mjs`,
  `LANTERN_CREDENTIAL_SOCKET`)

`lantern-delegate` calls this skill's CLI as a subprocess (`check`, `create --branch`, `description-block`)
and holds no credential code of its own.

Self-contained: it imports only from its own `scripts/` folder, so it works when copied alone into a
project. A user's own Bitbucket skill takes precedence; Lantern never replaces a skill it did not
install. The user-facing strings are in `scripts/messages.json`.
