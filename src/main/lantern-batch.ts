const BATCH_SIZE = 64;

async function mapInBatches<T, R>(items: T[], fn: (item: T) => Promise<R>, size = BATCH_SIZE): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export { mapInBatches };
