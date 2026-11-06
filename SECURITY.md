# Security Policy

## Reporting a vulnerability

Please report security problems privately by e-mail to **hello@themobilereality.com**. Do not open a public issue, pull request or discussion for a vulnerability, because that makes it public before a fix exists.

Lantern is an Electron desktop app that stores access tokens for code hosts and ticket trackers and starts coding agents on your machine, so reports about credential handling, the IPC surface, the embedded editor and the agent permissions are especially welcome.

## What to include

- The version of Lantern (or the commit) and your operating system.
- What you found and what an attacker could do with it.
- Steps to reproduce it, or a proof of concept.
- Any logs or screenshots, with tokens and other secrets removed.

## What happens next

We read every report and will tell you whether we consider it a vulnerability. This is a small project and we do not promise a response time or a fix date. We will keep you informed as we work on it and, if you want, credit you when the fix is released.

## Supported versions

Only the latest release receives security fixes.

## Scope

In scope: the Lantern application and the skills and scripts shipped in this repository.

Out of scope: vulnerabilities in third-party services (code hosts, ticket trackers, the Claude service) or in upstream dependencies that do not affect Lantern. Please report those to their maintainers.
