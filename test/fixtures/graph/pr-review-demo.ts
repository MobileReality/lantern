import type { ProjectFile } from '../../../src/main/filecontent';
import type { LanternFlowStory, LanternMap, LanternPrOverlay } from '../../../src/main/lantern';
import type { PrFileDiff } from '../../../src/main/lantern-prdiff';
import type { PrFile } from '../../../src/main/lantern-prfile';
import { mapOf, node, pr } from '../../helpers/lantern-map';

const PR_ID = '317';

const files = {
  'src/checkout/checkout-page.tsx': `import { OrderSummary } from './order-summary';
import { useCheckout } from './use-checkout';

export function CheckoutPage() {
  const checkout = useCheckout();
  return <OrderSummary checkout={checkout} />;
}
`,
  'src/checkout/use-checkout.ts': `import { calculateOrderTotal } from '../pricing/calculate-order-total';

export function useCheckout() {
  return { total: calculateOrderTotal([24, 18]), currency: 'EUR' };
}
`,
  'src/checkout/order-summary.tsx': `type Checkout = {
  total: number;
  currency: string;
};

function formatAmount(amount: number, currency: string) {
  return new Intl.NumberFormat('en-IE', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function OrderSummary({ checkout }: { checkout: Checkout }) {
  const amount = formatAmount(checkout.total, checkout.currency);

  return (
    <section aria-label="Order summary">
      <h2>Your order</h2>
      <dl>
        <div className="order-total">
          <dt>Total</dt>
          <dd aria-live="polite">{amount}</dd>
        </div>
      </dl>
      <p>Includes every item in your basket.</p>
      <button type="submit" disabled={checkout.total <= 0}>
        Continue to payment
      </button>
    </section>
  );
}
`,
  'src/pricing/calculate-order-total.ts': `export function calculateOrderTotal(prices: number[]) {
  return prices.reduce((total, price) => total + price, 0);
}
`,
  'src/pricing/legacy-total.ts': `export function legacyTotal(subtotal: number, shipping: number) {
  return subtotal + shipping;
}
`,
};

const diffs: Record<string, string> = {
  'src/checkout/order-summary.tsx': `diff --git a/src/checkout/order-summary.tsx b/src/checkout/order-summary.tsx
--- a/src/checkout/order-summary.tsx
+++ b/src/checkout/order-summary.tsx
@@ -1,20 +1,31 @@
 type Checkout = {
   total: number;
   currency: string;
 };

 function formatAmount(amount: number, currency: string) {
-  return currency + ' ' + amount.toFixed(2);
+  return new Intl.NumberFormat('en-IE', {
+    style: 'currency',
+    currency,
+  }).format(amount);
 }

 export function OrderSummary({ checkout }: { checkout: Checkout }) {
   const amount = formatAmount(checkout.total, checkout.currency);

   return (
     <section aria-label="Order summary">
       <h2>Your order</h2>
-      <strong>{amount}</strong>
-      <p>Shipping calculated at the next step.</p>
+      <dl>
+        <div className="order-total">
+          <dt>Total</dt>
+          <dd aria-live="polite">{amount}</dd>
+        </div>
+      </dl>
+      <p>Includes every item in your basket.</p>
+      <button type="submit" disabled={checkout.total <= 0}>
+        Continue to payment
+      </button>
     </section>
   );
 }
`,
  'src/checkout/use-checkout.ts': `diff --git a/src/checkout/use-checkout.ts b/src/checkout/use-checkout.ts
index 431ff0a..833aeef 100644
--- a/src/checkout/use-checkout.ts
+++ b/src/checkout/use-checkout.ts
@@ -1,5 +1,5 @@
-import { legacyTotal } from '../pricing/legacy-total';
+import { calculateOrderTotal } from '../pricing/calculate-order-total';

 export function useCheckout() {
-  return { total: legacyTotal(42, 0), currency: 'EUR' };
+  return { total: calculateOrderTotal([24, 18]), currency: 'EUR' };
 }
`,
  'src/pricing/calculate-order-total.ts': `diff --git a/src/pricing/calculate-order-total.ts b/src/pricing/calculate-order-total.ts
new file mode 100644
--- /dev/null
+++ b/src/pricing/calculate-order-total.ts
@@ -0,0 +1,3 @@
+export function calculateOrderTotal(prices: number[]) {
+  return prices.reduce((total, price) => total + price, 0);
+}
`,
  'src/pricing/legacy-total.ts': `diff --git a/src/pricing/legacy-total.ts b/src/pricing/legacy-total.ts
deleted file mode 100644
--- a/src/pricing/legacy-total.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function legacyTotal(subtotal: number, shipping: number) {
-  return subtotal + shipping;
-}
`,
  'test/checkout/calculate-order-total.test.ts': `diff --git a/test/checkout/calculate-order-total.test.ts b/test/checkout/calculate-order-total.test.ts
new file mode 100644
--- /dev/null
+++ b/test/checkout/calculate-order-total.test.ts
@@ -0,0 +1,5 @@
+import { calculateOrderTotal } from '../../src/pricing/calculate-order-total';
+
+test('adds every price', () => {
+  expect(calculateOrderTotal([24, 18])).toBe(42);
+});
`,
};

const demoFlow: LanternFlowStory[] = [
  {
    title: 'An admin lets a user refund orders',
    steps: [
      { kind: 'actor', text: 'Admin' },
      { kind: 'action', text: 'changes permissions of' },
      { kind: 'subject', text: 'another user' },
    ],
    below: [
      { kind: 'actor', text: 'Another user' },
      { kind: 'interaction', text: 'can now refund orders' },
      { kind: 'consequence', old: 'could only view orders', new: 'can refund orders' },
    ],
  },
  {
    title: 'A customer sees an itemized total',
    steps: [
      { kind: 'actor', text: 'Customer' },
      { kind: 'action', text: 'opens' },
      { kind: 'subject', text: 'the checkout summary', files: ['src/checkout/order-summary.tsx'] },
    ],
    below: [
      { kind: 'interaction', text: 'sees the total with the currency', files: ['src/checkout/order-summary.tsx', 'src/checkout/use-checkout.ts'] },
      { kind: 'consequence', old: 'EUR 42.00', new: '€42.00', files: ['src/pricing/calculate-order-total.ts', 'src/pricing/legacy-total.ts', 'test/checkout/calculate-order-total.test.ts'] },
    ],
  },
];

const richFlow: LanternFlowStory[] = [
  demoFlow[0],
  demoFlow[1],
  {
    title: 'A shopper outside the euro area pays in the currency of their own country',
    steps: [
      { kind: 'actor', text: 'Shopper from outside the euro area' },
      { kind: 'action', text: 'switches the currency in' },
      { kind: 'subject', text: 'the checkout summary', files: ['src/checkout/order-summary.tsx'] },
      { kind: 'action', text: 'then confirms the order from' },
      { kind: 'subject', text: 'the payment step, with the total they were shown', files: ['src/checkout/use-checkout.ts'] },
    ],
    below: [
      { kind: 'interaction', text: 'sees every price and shipping cost in one currency, rounded like their bank', files: ['src/checkout/order-summary.tsx', 'src/pricing/calculate-order-total.ts'] },
      { kind: 'interaction', text: 'can no longer be charged a total that differs from the one on screen' },
      { kind: 'consequence', old: 'a fixed EUR total, converted by the card issuer after the order', new: 'the total shown at checkout is the amount charged, in the shopper\'s currency', files: ['src/pricing/calculate-order-total.ts', 'src/pricing/legacy-total.ts', 'test/checkout/calculate-order-total.test.ts'] },
    ],
  },
];

const prReviewDemo = mapOf({
  project: 'PR review demo · synthetic data',
  nodes: [
    node('src/checkout/checkout-page.tsx', 'page', { feature: 'checkout', purpose: 'Starts the checkout experience.' }),
    node('src/checkout/use-checkout.ts', 'hook', { feature: 'checkout', purpose: 'Builds the checkout view model.' }),
    node('src/checkout/order-summary.tsx', 'component', { feature: 'checkout', purpose: 'Shows the final amount.' }),
  ],
  relations: [
    { from: 'src/checkout/checkout-page.tsx', arrow: '>', to: 'src/checkout/use-checkout.ts', ext: null, symbol: null, label: 'gets checkout state' },
    { from: 'src/checkout/checkout-page.tsx', arrow: '>', to: 'src/checkout/order-summary.tsx', ext: null, symbol: null, label: 'renders' },
  ],
  features: [
    { id: 'checkout', description: 'Checkout' },
    { id: 'pricing', description: 'Pricing' },
  ],
  total: 3,
  prs: [pr(PR_ID, {
    title: 'Use itemized pricing in checkout',
    url: '',
    branch: 'M2M-317-itemized-checkout-total',
    base: 'main',
    opened: '2026-10-05',
    tip: 'demo-tip-317',
    ordered: true,
    flow: demoFlow,
    summary: 'Demo data · Click a diff, then use the arrow keys to follow the review order.',
    files: [
      { path: 'src/checkout/use-checkout.ts', kind: 'modified', mapped: true, reason: 'Start at the caller to see how checkout adopts the new pricing contract.' },
      { path: 'src/pricing/calculate-order-total.ts', kind: 'added', mapped: true, reason: 'Then review the new itemized calculation.' },
      { path: 'src/pricing/legacy-total.ts', kind: 'removed', mapped: false, reason: 'The old fixed-shape helper is no longer needed.' },
      { path: 'src/checkout/order-summary.tsx', kind: 'modified', mapped: true, reason: 'Review the visible checkout changes: currency formatting, an accessible total, and the payment action.' },
      { path: 'test/checkout/calculate-order-total.test.ts', kind: 'added', mapped: false, reason: 'Finish with the focused behavior check.' },
    ],
  })],
});

const overlay: LanternPrOverlay = {
  prId: PR_ID,
  tip: 'demo-tip-317',
  nodes: [
    node('src/checkout/use-checkout.ts', 'hook', { feature: 'checkout', hash: 'branch-use-checkout', purpose: 'Builds checkout state from itemized prices.' }),
    node('src/checkout/order-summary.tsx', 'component', { feature: 'checkout', hash: 'branch-order-summary', purpose: 'Formats the itemized total and offers a payment action.' }),
    node('src/pricing/calculate-order-total.ts', 'util', { feature: 'pricing', hash: 'branch-total', prNew: true, purpose: 'Adds an arbitrary list of prices.' }),
  ],
  relations: [
    { from: 'src/checkout/use-checkout.ts', arrow: '>', to: 'src/pricing/calculate-order-total.ts', ext: null, symbol: null, label: 'calculates total' },
  ],
  missing: ['test/checkout/calculate-order-total.test.ts'],
  warnings: [],
};

async function readDemoFile(path: string): Promise<ProjectFile> {
  const text = files[path as keyof typeof files];
  return text === undefined ? { exists: false, text: '', truncated: 0 } : { exists: true, text, truncated: 0 };
}

async function readDemoPrFile(_pr: string, path: string): Promise<PrFile> {
  const text = files[path as keyof typeof files] ?? (path === 'test/checkout/calculate-order-total.test.ts' ? diffs[path].split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++')).map((line) => line.slice(1)).join('\n') : '');
  return { ok: !!text, text, truncated: false, binary: false, version: path === 'src/pricing/legacy-total.ts' ? 'before' : 'branch' };
}

async function readDemoPrDiff(_pr: string, path: string): Promise<PrFileDiff> {
  return { ok: path in diffs, diff: diffs[path] ?? '', truncated: false, binary: false };
}

async function readDemoPrOverlay(): Promise<LanternPrOverlay> {
  return overlay;
}

export { PR_ID, demoFlow, prReviewDemo, readDemoFile, readDemoPrDiff, readDemoPrFile, readDemoPrOverlay, richFlow };
