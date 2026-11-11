import type { Page } from '@playwright/test';

interface Clipped {
  pane: string;
  element: string;
  text: string;
  reason: 'cut' | 'ellipsis-without-title' | 'squeezed';
  overBy: number;
}

const PANES = ['.lt-side', '.lt-overview', '.lt-review', '.lt-main'];
const SLACK_PX = 1.5;
const SQUEEZED_PX = 64;
const COLLAPSIBLE = '.file-directory';

async function findClippedText(page: Page, panes: string[] = PANES): Promise<Clipped[]> {
  return page.evaluate(
    ({ panes, slack, squeezed, collapsible }) => {
      const found: Clipped[] = [];
      const label = (el: Element) => `${el.tagName.toLowerCase()}${[...el.classList].slice(0, 3).map((c) => `.${c}`).join('')}`;
      const clips = (style: CSSStyleDeclaration) => style.overflowX !== 'visible' && style.overflowX !== 'auto' && style.overflowX !== 'scroll';
      const hasTitle = (el: Element) => !!el.closest('[title]:not([title=""]), [data-tip]:not([data-tip=""])');
      const visible = (el: Element) => {
        for (let node: Element | null = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden' || (node as HTMLElement).hidden) return false;
          if (node.classList.contains('lt-pixi-a11y') || node.closest('.sr-only, .lt-sr, .lt-explain-announce, .lt-cm-announce')) return false;
        }
        return true;
      };
      for (const selector of panes) {
        const pane = document.querySelector(selector);
        if (!pane || !visible(pane)) continue;
        const paneRect = pane.getBoundingClientRect();
        const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.textContent?.trim() ?? '';
          const owner = node.parentElement;
          if (!text || !owner || !visible(owner) || owner.closest('canvas, svg, script, style')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          const rect = range.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          let overBy = Math.max(rect.right - paneRect.right, paneRect.left - rect.left);
          let ellipsized = false;
          for (let ancestor: Element | null = owner; ancestor && ancestor !== pane.parentElement; ancestor = ancestor.parentElement) {
            const style = getComputedStyle(ancestor);
            if (!clips(style)) continue;
            const box = ancestor.getBoundingClientRect();
            const edge = Math.max(rect.right - box.right, box.left - rect.left);
            if (edge <= slack) continue;
            if (style.textOverflow === 'ellipsis') ellipsized = true;
            else overBy = Math.max(overBy, edge);
          }
          if (overBy > slack && !ellipsized) found.push({ pane: selector, element: label(owner), text: text.slice(0, 60), reason: 'cut', overBy: Math.round(overBy) });
        }
        for (const el of pane.querySelectorAll<HTMLElement>('*')) {
          if (getComputedStyle(el).textOverflow !== 'ellipsis' || !visible(el)) continue;
          const overBy = el.scrollWidth - el.clientWidth;
          if (overBy <= slack) continue;
          const text = (el.textContent ?? '').trim().slice(0, 60);
          if (!hasTitle(el)) found.push({ pane: selector, element: label(el), text, reason: 'ellipsis-without-title', overBy });
          else if (el.clientWidth < squeezed && !el.matches(collapsible)) found.push({ pane: selector, element: label(el), text, reason: 'squeezed', overBy });
        }
      }
      return found;
    },
    { panes, slack: SLACK_PX, squeezed: SQUEEZED_PX, collapsible: COLLAPSIBLE },
  );
}

export { findClippedText };
export type { Clipped };
