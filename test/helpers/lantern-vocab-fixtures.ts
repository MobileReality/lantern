import type { FixtureFile, FixtureSpec } from './lantern-vocab-project';

const PLATFORMS = ['portal web portal/**', 'kiosk web kiosk/**', 'service backend service/**'];

function tidyFiles(): FixtureFile[] {
  return [
    { path: 'portal/reports.ts', feature: 'reports', role: 'page', relations: ['= service/reports.ts'] },
    { path: 'portal/checkout.ts', feature: 'checkout', role: 'page', relations: ['= service/checkout.ts'] },
    { path: 'kiosk/reports.ts', feature: 'reports', role: 'page', relations: ['= service/reports.ts'] },
    { path: 'kiosk/checkout.ts', feature: 'checkout', role: 'page', relations: ['= service/checkout.ts'] },
    { path: 'service/reports.ts', feature: 'reports', relations: ['> ext:object-store'] },
    { path: 'service/checkout.ts', feature: 'checkout', relations: ['> ext:payment-gateway', '> ext:mail-relay'] },
    { path: 'service/accounts.ts', feature: 'accounts', relations: ['> ext:object-store', '> ext:mail-relay'] },
    { path: 'service/gateway-client.ts', relations: ['> ext:payment-gateway'] },
  ];
}

const TIDY_SYSTEMS = ['mail-relay', 'object-store', 'payment-gateway'];

function tidySpec(): FixtureSpec {
  return { files: tidyFiles(), features: ['accounts', 'checkout', 'reports'], platforms: PLATFORMS, systems: TIDY_SYSTEMS };
}

function untidyFiles(): FixtureFile[] {
  return [
    { path: 'portal/reports.ts', feature: 'reports', role: 'page', relations: ['= service/reports.ts'] },
    { path: 'portal/checkout.ts', feature: 'checkout', role: 'page', relations: ['= service/checkout.ts'] },
    { path: 'kiosk/reports.ts', feature: 'kiosk-reports', role: 'page', relations: ['= service/reports.ts'] },
    { path: 'kiosk/checkout.ts', feature: 'kiosk-checkout', role: 'page', relations: ['= service/checkout.ts'] },
    { path: 'kiosk/receipt.ts', feature: 'kiosk-checkout', role: 'page' },
    { path: 'service/reports.ts', feature: 'reports', relations: ['> ext:object-store'] },
    { path: 'service/checkout.ts', feature: 'checkout', relations: ['> ext:payment-gateway', '> ext:payment-gateway-api'] },
    { path: 'service/mailer.ts', feature: 'acme-mail', relations: ['> ext:acme-mail', '> ext:mail-relay'] },
    { path: 'service/ui-theme.ts', relations: ['< ext:@acme/ui-kit'] },
    { path: 'service/tracking.ts', relations: ['> ext:error-tracker'] },
    { path: 'service/accounts.ts', feature: 'accounts', relations: ['> ext:object-store', '> ext:mail-relay'] },
  ];
}

function untidySpec(withSystems = true): FixtureSpec {
  return {
    files: untidyFiles(),
    features: ['accounts', 'acme-mail', 'checkout', 'kiosk-checkout', 'kiosk-reports', 'reports'],
    platforms: PLATFORMS,
    systems: withSystems ? ['acme-mail', 'mail-relay', 'object-store', 'payment-gateway'] : undefined,
  };
}

function plainSpec(): FixtureSpec {
  return {
    files: [
      { path: 'src/orders.ts', feature: 'orders', relations: ['> ext:payment-gateway', '= src/prices.ts'] },
      { path: 'src/prices.ts', feature: 'orders' },
      { path: 'src/main.ts', role: 'entry' },
    ],
    features: ['orders'],
  };
}

export { plainSpec, tidySpec, untidySpec };
