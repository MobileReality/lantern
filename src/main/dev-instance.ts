import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface DevInstance {
  name: string;
  key: string;
  branch: string | null;
  worktree: string;
  hue: number;
}

const HUE_STEPS = 360;
const SHORT_NAME_MAX = 10;
const BYTES_PER_PIXEL = 4;
const CHANNEL_MAX = 255;
const KEY_HASH_CHARS = 6;
const SEED_FILES = ['ccm-projects.json', 'ccm-settings.json', 'ccm-skills.json', 'settings.json'];
const RECORD_FILE = 'lantern-instance.json';
const DEBUG_HANDLE_FILE = 'lantern-debug.json';
const PRIVATE_MODE = 0o600;

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dev';
const digest = (text: string) => createHash('sha1').update(text).digest('hex');

export function devInstance(appDir: string, env: NodeJS.ProcessEnv, readBranch: (dir: string) => string | null): DevInstance {
  const worktree = path.dirname(appDir);
  const branch = readBranch(worktree);
  const override = env.LANTERN_INSTANCE?.trim();
  const key = override ? slug(override) : `${slug(path.basename(worktree))}-${digest(worktree).slice(0, KEY_HASH_CHARS)}`;
  const name = override || branch || path.basename(worktree);
  return { name, key, branch, worktree, hue: parseInt(digest(key).slice(0, 8), 16) % HUE_STEPS };
}

export function shortName(name: string) {
  const last = name.split('/').filter(Boolean).pop() ?? name;
  return last.length > SHORT_NAME_MAX ? `${last.slice(0, SHORT_NAME_MAX - 1)}…` : last;
}

export function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    return Math.round(CHANNEL_MAX * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [channel(0), channel(8), channel(4)];
}

export function tintBitmap(bitmap: Buffer, [r, g, b]: [number, number, number]) {
  const out = Buffer.from(bitmap);
  for (let i = 0; i < out.length; i += BYTES_PER_PIXEL) {
    const alpha = out[i + 3] / CHANNEL_MAX;
    out[i] = Math.round(b * alpha);
    out[i + 1] = Math.round(g * alpha);
    out[i + 2] = Math.round(r * alpha);
  }
  return out;
}

export function seedUserData(dir: string, from: string) {
  for (const name of SEED_FILES) {
    const src = path.join(from, name);
    const dst = path.join(dir, name);
    try {
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        fs.mkdirSync(dir, { recursive: true });
        fs.copyFileSync(src, dst);
      }
    } catch {}
  }
}

// The record can hold the debug harness token, so it is owner-only; writeFileSync applies a mode to a
// new file only, hence the chmod before the write for a file an older run left readable.
function writePrivate(file: string, data: unknown) {
  try {
    if (fs.existsSync(file)) fs.chmodSync(file, PRIVATE_MODE);
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, { mode: PRIVATE_MODE });
  } catch {}
  return file;
}

export function recordInstance(appDir: string, patch: Record<string, unknown>) {
  const file = path.join(appDir, RECORD_FILE);
  let current: Record<string, unknown> = {};
  try {
    current = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {}
  if (current.pid !== process.pid) current = { pid: process.pid };
  return writePrivate(file, { ...current, ...patch });
}

export function recordDebugHandle(userData: string, handle: Record<string, unknown>) {
  return writePrivate(path.join(userData, DEBUG_HANDLE_FILE), handle);
}
