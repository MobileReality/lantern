import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { areasPayload } from './helpers/lantern-macro-areas-payload';

const FIXTURE = path.join(__dirname, 'fixtures', 'lantern-macro-areas-payload.json');

describe('the areas payload the end-to-end harness draws', () => {
  it('is what the derivation gives today for the fixture project and its areas', async () => {
    const { ok: _ok, ...payload } = areasPayload();

    await expect(`${JSON.stringify(payload, null, 2)}\n`).toMatchFileSnapshot(FIXTURE);
  });
});
