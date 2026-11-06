interface CopyFeedback {
  copy(text: string): Promise<boolean>;
  copied(): boolean;
  dispose(): void;
}

const COPIED_MS = 1500;

function createCopyFeedback(write: (text: string) => Promise<void>, onExpire: () => void): CopyFeedback {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let justCopied = false;

  return {
    async copy(text) {
      try {
        await write(text);
      } catch {
        return false;
      }
      justCopied = true;
      clearTimeout(timer);
      timer = setTimeout(() => {
        justCopied = false;
        onExpire();
      }, COPIED_MS);
      return true;
    },
    copied: () => justCopied,
    dispose() {
      clearTimeout(timer);
    },
  };
}

export { createCopyFeedback };
export type { CopyFeedback };
