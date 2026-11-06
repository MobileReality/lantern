import { describe, expect, it } from 'vitest';
import { edgeCurve, edgePath } from '../src/renderer/lib/lanternlayout';
import type { Pos } from '../src/renderer/lib/lanternlayout';

function position(x: number, y: number, sameColumn: object): Pos {
  return { x, y, w: 100, h: 20, col: sameColumn as Pos['col'], item: { key: `${x}:${y}`, label: '', dir: '' } };
}

describe('shared graph edge geometry', () => {
  it('provides the same numeric cubic used by SVG and GPU renderers', () => {
    const left = position(10, 20, {});
    const right = position(250, 80, {});
    const curve = edgeCurve(left, right);
    expect(curve).toEqual({
      from: { x: 110, y: 30 },
      control1: { x: 180, y: 30 },
      control2: { x: 180, y: 90 },
      to: { x: 250, y: 90 },
    });
    expect(edgePath(left, right)).toBe('M110,30 C180,30 180,90 250,90');
  });
});
