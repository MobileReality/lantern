interface PaneSize {
  width: number;
  height: number;
}

function insideBox(client: number, outer: number, offset: number) {
  return Math.max(0, Math.min(client, Math.floor(outer) - (offset - client)));
}

// The border box, unlike clientWidth/clientHeight, ignores scrollbars, so it only changes when the pane itself is resized.
function outerSize(pane: HTMLElement): PaneSize {
  return { width: pane.offsetWidth, height: pane.offsetHeight };
}

// clientWidth/clientHeight round a fractional pane up, so a canvas of exactly that size overflows its own scroll area
// by a sub-pixel, raises a scrollbar, shrinks the pane, and the canvas is resized again without end.
function innerSize(pane: HTMLElement): PaneSize {
  const box = pane.getBoundingClientRect();
  return {
    width: insideBox(pane.clientWidth, box.width, pane.offsetWidth),
    height: insideBox(pane.clientHeight, box.height, pane.offsetHeight),
  };
}

export { innerSize, outerSize };
export type { PaneSize };
