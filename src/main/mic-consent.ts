interface MicConsentDeps {
  confirm: () => Promise<boolean>;
  apply: () => unknown;
  recycle: () => void;
}

async function enableMicrophone({ confirm, apply, recycle }: MicConsentDeps): Promise<boolean> {
  const consented = await confirm().catch(() => false);
  if (!consented) return false;
  apply();
  recycle();
  return true;
}

export { enableMicrophone };
export type { MicConsentDeps };
