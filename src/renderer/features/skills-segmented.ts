import { el } from '../lib/util';
import { KEY } from './skills-state';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  tip?: string;
}

interface SegmentedConfig<T extends string> {
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  className: string;
  zone: string;
  onSelect: (value: T, viaKeyboard: boolean) => void;
}

const STEP: Record<string, number> = { [KEY.right]: 1, [KEY.down]: 1, [KEY.left]: -1, [KEY.up]: -1 };

function target<T extends string>(options: readonly SegmentOption<T>[], at: number, key: string): T | null {
  if (key === KEY.home) return options[0].value;
  if (key === KEY.end) return options[options.length - 1].value;
  const step = STEP[key];
  return step === undefined ? null : options[(at + step + options.length) % options.length].value;
}

export function segmentedControl<T extends string>({ label, options, value, className, zone, onSelect }: SegmentedConfig<T>): HTMLElement {
  const group = el('div', `sk-seg ${className}`);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  const buttons = options.map((option) => {
    const button = el('button', `sk-seg-opt${option.value === value ? ' is-on' : ''}`);
    button.type = 'button';
    button.dataset.segment = option.value;
    button.dataset.fk = `${zone}:${option.value}`;
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(option.value === value));
    button.tabIndex = option.value === value ? 0 : -1;
    button.append(el('span', 'sk-seg-label', option.label));
    if (option.count !== undefined) button.append(el('span', `sk-seg-count${option.count === 0 ? ' is-zero' : ''}`, String(option.count)));
    if (option.tip) button.dataset.tip = option.tip;
    button.addEventListener('click', () => onSelect(option.value, false));
    return button;
  });
  group.addEventListener('keydown', (event) => {
    const at = buttons.findIndex((button) => button === document.activeElement);
    const next = at === -1 ? null : target(options, at, event.key);
    if (next === null) return;
    event.preventDefault();
    onSelect(next, true);
  });
  group.append(...buttons);
  return group;
}
