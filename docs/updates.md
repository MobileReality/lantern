# Updates

An installed Lantern looks for a newer release by itself. On a Mac it downloads the update in the
background and installs it only when no terminal or running work would be ended. On Windows it only tells you that a new
version exists and links to it. A copy started from source (`pnpm start`) or a dev profile never checks.

## On a Mac

Lantern checks when it starts and then every four hours. When there is a newer release it downloads it
and waits. The update installs, and Lantern restarts, only when nothing would be ended:

- no run started by Lantern itself is going,
- no editor terminal is open and no process started through the editor is running.

Sessions in other terminals, such as iTerm, do not block an update: a restart does not end them.

While something is alive you see **Update ready: restart when your sessions finish**, and the update
installs by itself as soon as nothing is. **Not now** keeps it from installing on its own; the downloaded
update then installs the next time you quit Lantern, or when you choose **Restart now**. **Restart now**
while something is alive first lists what would be ended (for example "2 editor terminals and 1 running process")
and restarts only after you confirm. Lantern never restarts by itself while the check says something is alive,
and it waits when it cannot tell.

If the update service has no download for your Mac, Lantern does nothing and records one warning in
[Diagnostics](diagnostics.md); **Check for Updates…** then points you to the release page.

## On Windows

Lantern does not update itself. When the newest release is newer than yours, a notice says
**Lantern X is available**, with **View release** to open the release page on GitHub, and **Dismiss**.

## Check for Updates…

The application menu has **Check for Updates…** (in the **File** menu on Windows). It reports whether you are up
to date, that an update is downloading or ready, or that a newer version is available, and it says so plainly
when the check could not be made. A failed check never opens an error dialog; it is recorded in [Diagnostics](diagnostics.md).

## What is sent, and how to turn it off

- On a Mac, each check sends your Lantern version and the platform (`darwin`, `arm64`) in the address of a request
  to `update.electronjs.org`, the public update service for open source Electron apps, which looks up the
  releases of `MobileReality/lantern` on GitHub. The download itself comes from GitHub.
- On Windows, each check is one request to `api.github.com` for the latest release of `MobileReality/lantern`,
  without a token and without your version.
- Lantern sends nothing else for updates: no identifier, no project information, no analytics.

Turn it off in **Settings**, under **Updates**, by clearing **Check for updates automatically**
(`updates.checkAutomatically` in the settings file). Off, Lantern makes no update request at all,
and **Check for Updates…** says that automatic checks are off instead of checking.
