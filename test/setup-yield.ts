import { afterEach } from 'vitest';

const realSetImmediate = setImmediate;

afterEach(() => new Promise<void>((resolve) => realSetImmediate(resolve)));
