interface ConsentDeps {
  stored: (project: string) => boolean | undefined;
  remember: (project: string, granted: boolean) => void;
  ask: (project: string) => Promise<boolean>;
}

function createPermissionConsent({ stored, remember, ask }: ConsentDeps) {
  const pending = new Map<string, Promise<boolean>>();
  return (project: string): Promise<boolean> => {
    const known = stored(project);
    if (known !== undefined) return Promise.resolve(known);
    const open = pending.get(project);
    if (open) return open;
    const question = ask(project)
      .then((granted) => {
        remember(project, granted);
        return granted;
      })
      .catch(() => false)
      .finally(() => pending.delete(project));
    pending.set(project, question);
    return question;
  };
}

export { createPermissionConsent };
export type { ConsentDeps };
