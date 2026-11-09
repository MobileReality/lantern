# Troubleshooting

## Microphone / voice missing in the embedded editor (after a Claude Code update)

### Why it happens

The embedded editor runs via `code serve-web`, which VS Code treats as a **remote**
session. The Claude Code extension disables its microphone/voice whenever it runs
in a remote host:

```js
isSpeechToTextEnabled(){ if(<vscode>.env.remoteName) return false; /* …auth + capability… */ }
```

serve-web is "remote" in name only — it's physically your own Mac — so the app
strips just that one guard from the **serve-web copy** of the extension
(`~/.vscode-server/extensions/anthropic.claude-code-*/extension.js`). Your native
VS Code extension (`~/.vscode/extensions/…`) is never touched.

When the Claude Code extension **auto-updates**, VS Code installs a fresh,
unpatched copy in a new version folder — so the mic disappears again until the
patch is re-applied.

### Enabling it from the app

Lantern never edits the extension on its own. Click **Enable mic** in the toolbar
and confirm the warning: it says that a file of a third-party extension is patched,
that the change can break when the extension updates, and that the publisher does not
endorse it. Only after you confirm does Lantern patch the installed version (keeping
`extension.js.ccm-bak`) and recycle serve-web so the extension host reloads it.
Cancelling changes nothing.

After a Claude Code update the new version folder is unpatched again, so click
**Enable mic** again. If an agent is mid-run, reopen the project tab once it is done.

### Manual fix (if it's still missing)

```bash
npm run patch-mic:check     # show patch status for each installed version
npm run patch-mic           # apply the patch
npm run patch-mic:revert    # restore the original extension.js from backup
```

After `patch-mic`, **restart the serve-web server** so the extension host reloads:
quit + relaunch the app, or from the menu bar reopen the workspace. Then close the
project tab (×) and reopen it.

### If `patch-mic` says "Nothing to patch" but the mic is still gone

That means the extension's code changed shape and the matcher no longer finds the
guard. Re-derive it:

1. Find the file:
   ```bash
   ls -d ~/.vscode-server/extensions/anthropic.claude-code-*/extension.js
   ```
2. Search it for the speech gate:
   ```bash
   grep -o 'isSpeechToTextEnabled(){[^}]*}' ~/.vscode-server/extensions/anthropic.claude-code-*/extension.js
   ```
3. You're looking for a clause like `if(<something>.env.remoteName)return!1;` at the
   start of `isSpeechToTextEnabled(){…}`. The variable before `.env.remoteName` is a
   minified name that can change between versions.
4. Update the `GUARD` regex in **both** `scripts/patch-claude-mic.js` and
   `src/main/serveweb.ts` (`ensureSpeechPatch`) to match the new shape, then rebuild
   (`npm run dist`) and run `npm run patch-mic`.

### Verifying

After patching + reloading, open the **Claude Code** panel in the embedded editor;
the mic button should be in the input row. First use triggers a macOS prompt —
**System Settings → Privacy & Security → Microphone → Lantern**.

> Caveat: this patches a third-party extension's bundled code. It's reversible
> (`npm run patch-mic:revert`, or delete the `.ccm-bak` files), narrowly scoped
> (only the remote guard, only the serve-web copy), and only enables a feature you
> already have in native VS Code.

---

## Embedded editor stuck on "Starting VS Code server…"

The app probes port 9888 and reuses or respawns `code serve-web`. If it's stuck:

- Quit and relaunch the app (it re-probes and self-heals every few seconds while
  the workspace is open).
- Make sure nothing else is using port 9888.
- Confirm the VS Code CLI exists: `ls "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"`.

## macOS: "Attempt to modify an app by “Lantern” was prevented"

macOS shows this notification (Privacy & Protection, App Management) while the
embedded editor is running.

### Why it happens

Lantern starts VS Code (`code serve-web`, from `/Applications/Visual Studio Code.app`)
for the embedded editor. When VS Code touches its own app bundle, macOS treats
Lantern as the responsible process, so App Management protection
(`kTCCServiceSystemPolicyAppBundles`) blocks the write and reports it as Lantern's.
Lantern itself does not write into other apps.

It is harmless: only that write is blocked and the embedded editor keeps working.

### Fix

Open **System Settings → Privacy & Security → App Management** and enable
**Lantern**. If it is not in the list, add it with **+**.

> Builds signed ad hoc (`sign:adhoc`, a local reinstall) change identity, so macOS
> may forget the permission after each reinstall and you grant it again. A Developer
> ID signature avoids that.

## App won't launch / "running in Node mode"

This Mac has `ELECTRON_RUN_AS_NODE=1` set in the shell, which makes Electron run as
plain Node. Always launch with `npm run app` (or `npm start`), which strips the var
(`env -u ELECTRON_RUN_AS_NODE`). Launching the `.app` from Finder is unaffected.
