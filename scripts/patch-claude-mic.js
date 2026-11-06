#!/usr/bin/env node
'use strict';

// Re-enable Claude Code's microphone/voice in the embedded (serve-web) editor.
//
// The Claude Code VS Code extension disables speech-to-text whenever it runs in a
// "remote" host:  isSpeechToTextEnabled(){ if(<vscode>.env.remoteName) return false; ... }
// serve-web is technically "remote" but is physically THIS machine, so we strip
// just that one guard. All other checks (Claude.ai auth + capability) are kept.
//
//   node scripts/patch-claude-mic.js            # apply
//   node scripts/patch-claude-mic.js --revert   # restore original from backup
//   node scripts/patch-claude-mic.js --check     # report status only

const fs = require('fs');
const os = require('os');
const path = require('path');

const EXT_DIR = path.join(os.homedir(), '.vscode-server', 'extensions');
const ID = 'anthropic.claude-code';
// Version-resilient: matches the minified guard regardless of the (renamed) vscode
// module variable, rather than an exact string.
const GUARD = /(isSpeechToTextEnabled\(\)\{)if\([\w$]+\.env\.remoteName\)return\s*!1;/;

const mode = process.argv.includes('--revert') ? 'revert' : process.argv.includes('--check') ? 'check' : 'apply';

let dirs;
try {
  dirs = fs.readdirSync(EXT_DIR).filter((n) => n.startsWith(ID));
} catch {
  console.error(`✗ No serve-web extensions dir at:\n  ${EXT_DIR}\n  Open the workspace in the app once so serve-web installs the extension, then retry.`);
  process.exit(1);
}
if (!dirs.length) {
  console.error(`✗ Claude Code extension not found under ${EXT_DIR}`);
  process.exit(1);
}

let changed = 0;
for (const d of dirs) {
  const file = path.join(EXT_DIR, d, 'extension.js');
  const bak = `${file}.ccm-bak`;
  let code;
  try {
    code = fs.readFileSync(file, 'utf8');
  } catch {
    console.log(`–  skip ${d} (no extension.js)`);
    continue;
  }
  const patched = !GUARD.test(code) && /isSpeechToTextEnabled\(\)\{if\([\w$.?]+getAuthStatus/.test(code);

  if (mode === 'check') {
    console.log(`${patched ? '✓ patched   ' : GUARD.test(code) ? '· un-patched' : '? unknown   '}  ${d}`);
    continue;
  }
  if (mode === 'revert') {
    if (fs.existsSync(bak)) {
      fs.copyFileSync(bak, file);
      console.log(`↩  reverted ${d}`);
      changed++;
    } else {
      console.log(`–  no backup for ${d} (nothing to revert)`);
    }
    continue;
  }
  // apply
  if (!GUARD.test(code)) {
    console.log(`✓  already patched: ${d}`);
    continue;
  }
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, code);
  fs.writeFileSync(file, code.replace(GUARD, '$1'));
  console.log(`✓  patched ${d}`);
  changed++;
}

if (mode === 'apply') {
  if (changed) {
    console.log(`\nPatched ${changed}. Restart the app (or the serve-web server) and reopen the project so the extension host reloads.`);
  } else {
    console.log(
      '\nNothing to patch. Either it is already patched, or the extension code changed shape and the\n' +
        'GUARD pattern in this script no longer matches — see TROUBLESHOOTING.md to update it.',
    );
  }
}
