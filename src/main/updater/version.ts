export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const NUMERIC = /^\d+$/;

export function parseVersion(text: string): ParsedVersion | null {
  const match = SEMVER.exec(text.trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split('.') : [] };
}

function compareNumbers(a: number, b: number): number {
  return Math.sign(a - b);
}

function comparePrereleaseIdentifier(a: string, b: string): number {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) return compareNumbers(Number(a), Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function comparePrerelease(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = comparePrereleaseIdentifier(a[i], b[i]);
    if (order !== 0) return order;
  }
  return compareNumbers(a.length, b.length);
}

export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  return compareNumbers(left.major, right.major) || compareNumbers(left.minor, right.minor) || compareNumbers(left.patch, right.patch) || comparePrerelease(left.prerelease, right.prerelease);
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareVersions(candidate, current) === 1;
}

export function displayVersion(text: string): string {
  return text.trim().replace(/^v(?=\d)/, '');
}
