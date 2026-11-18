# Handoff

Plan unreviewed (unattended run).

Cause: `classifyRemote` (host.mjs) asked `ssh -G <host>` for every ssh remote, so a developer's own
`Host bitbucket.org / HostName ssh.bitbucket.org` in ~/.ssh/config (ssh reads the passwd home, HOME
does not move it) made `git@bitbucket.org:` fail as "neither bitbucket.org nor github.com". Preflight
then printed no `ok host`, `ok identity` or `ok target` line, and the delivery flow never opened a PR.
Fix: a remote that names the host itself is that host; ssh -G stays for aliases.
