import { usd } from './agent.mjs';

export const SKIPPED = 'SKIP';

export function buildReport({ skill, mode, capUsd, slices, spentUsd }) {
  const failed = slices.filter((s) => !s.ok);
  const aborted = slices.find((s) => s.capExceeded) ?? null;
  return {
    skill,
    mode,
    capUsd,
    spentUsd: Math.round(spentUsd * 10000) / 10000,
    slices,
    overCap: aborted !== null || spentUsd > capUsd,
    passed: slices.length > 0 && failed.length === 0,
  };
}

function sliceLine(s) {
  const mark = s.skipped ? SKIPPED : s.ok ? 'PASS' : 'FAIL';
  const cost = s.costUsd ? ` (${usd(s.costUsd)})` : '';
  return `${mark.padEnd(4)} ${s.name.padEnd(22)} ${s.reason}${cost}`;
}

export function renderReport(report) {
  const lines = [`skill-test ${report.skill} (${report.mode})`, ...report.slices.map(sliceLine), ''];
  lines.push(`spent ${usd(report.spentUsd)} of cap ${usd(report.capUsd)}${report.overCap ? ' (CAP EXCEEDED)' : ''}`);
  const failed = report.slices.filter((s) => !s.ok && !s.skipped).map((s) => `${s.name}: ${s.reason}`);
  lines.push(report.passed ? 'RESULT: PASS' : `RESULT: FAIL (${failed.join('; ') || 'no slice ran'})`);
  return lines.join('\n');
}

export const exitCodeFor = (report) => (report.passed ? 0 : 1);
