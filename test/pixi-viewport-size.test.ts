// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { innerSize, outerSize } from '../src/renderer/lib/lantern-pixi/viewport-size';

interface Box {
  width: number;
  height: number;
}

function pane(box: Box, client: Box, offset: Box) {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ ...box, x: 0, y: 0, top: 0, left: 0, right: box.width, bottom: box.height, toJSON: () => ({}) });
  Object.defineProperties(el, {
    clientWidth: { value: client.width },
    clientHeight: { value: client.height },
    offsetWidth: { value: offset.width },
    offsetHeight: { value: offset.height },
  });
  return el;
}

describe('pixi pane size', () => {
  it('reads the border box so a scrollbar appearing does not look like a resize', () => {
    const full = { width: 748, height: 684 };
    expect(outerSize(pane(full, full, full))).toEqual(full);
    expect(outerSize(pane(full, { width: 738, height: 674 }, full))).toEqual(full);
  });

  it('keeps a whole-pixel pane as it is', () => {
    const full = { width: 748, height: 684 };
    expect(innerSize(pane(full, full, full))).toEqual(full);
  });

  it('never rounds a fractional pane up, so the canvas cannot overflow its scroll area', () => {
    const full = { width: 748, height: 684 };
    expect(innerSize(pane({ width: 748, height: 683.72 }, full, full))).toEqual({ width: 748, height: 683 });
  });

  it('leaves out the scrollbars that sit inside the box', () => {
    expect(innerSize(pane({ width: 748, height: 683.72 }, { width: 738, height: 674 }, { width: 748, height: 684 }))).toEqual({ width: 738, height: 673 });
  });

  it('is empty for a hidden pane', () => {
    const none = { width: 0, height: 0 };
    expect(innerSize(pane(none, none, none))).toEqual(none);
    expect(outerSize(pane(none, none, none))).toEqual(none);
  });
});
