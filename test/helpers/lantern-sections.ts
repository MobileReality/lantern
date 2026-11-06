import type { LanternCite, LanternMap, RbacSection, StatesSection } from '../../src/main/lantern';
import { mountLanternView } from '../../src/renderer/lib/lanternview';
import { node } from './lantern-map';

const cite = (p: string, symbol: string | null = null, mapped = true): LanternCite => ({ path: p, symbol, mapped });

const RBAC: RbacSection = {
  id: 'rbac',
  file: '.lantern/sections/rbac.section',
  type: 'rbac',
  platform: null,
  title: 'Who can do what',
  intro: 'Roles come from the auth token.',
  roles: [
    { id: 'admin', text: 'staff', cites: [cite('src/auth.ts', 'isAdmin')] },
    { id: 'guest', text: '', cites: [cite('src/auth.ts')] },
  ],
  resources: [{ id: 'orders', text: 'customer orders', cites: [cite('src/order.ts')] }],
  cells: [
    { role: 'admin', resource: 'orders', access: 'allow', text: '', cites: [cite('src/auth.ts')] },
    { role: 'guest', resource: 'orders', access: 'cond', text: 'only their own orders', cites: [cite('src/auth.ts', 'check'), cite('src/gone.ts', null, false)] },
  ],
  sources: [{ id: 'token-claims', text: 'role claim in the JWT', cites: [cite('src/auth.ts')] }],
  guards: [{ id: 'order-guard', text: 'checks the owner', cites: [cite('src/order.ts', 'guard')] }],
};

const STATES: StatesSection = {
  id: 'states',
  file: '.lantern/sections/states.section',
  type: 'states',
  platform: null,
  title: null,
  intro: null,
  machines: [
    {
      id: 'order',
      text: 'life of an order',
      cites: [cite('src/order.ts')],
      states: [
        { id: 'open', text: 'waiting for payment', initial: true, terminal: false, cites: [cite('src/order.ts')] },
        { id: 'paid', text: '', initial: false, terminal: false, cites: [cite('src/order.ts')] },
        { id: 'closed', text: '', initial: false, terminal: true, cites: [cite('src/order.ts')] },
      ],
      transitions: [
        { from: 'open', to: 'paid', text: 'customer pays', cites: [cite('src/order.ts', 'pay')] },
        { from: 'paid', to: 'closed', text: 'shipment delivered', cites: [cite('src/order.ts', 'close')] },
        { from: 'paid', to: 'open', text: 'payment reversed', cites: [cite('src/order.ts', 'reverse')] },
      ],
    },
  ],
};

const NODES = [node('src/auth.ts', 'middleware'), node('src/order.ts', 'service')];

function mount(map: LanternMap, opts: Parameters<typeof mountLanternView>[2] = {}) {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountLanternView(root, map, opts);
  return root;
}

const q = (root: HTMLElement, sel: string) => root.querySelector(sel) as HTMLElement;
const overlay = (root: HTMLElement) => q(root, '.lt-overlay');
const openSection = (root: HTMLElement, id: string) => q(root, `.lt-sec[data-section="${id}"]`).click();

export { cite, NODES, RBAC, STATES, mount, openSection, overlay, q };
