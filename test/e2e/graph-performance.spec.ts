import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import path from 'node:path';
import { closeGraphHarness, launchGraphHarness } from './support/graph-harness';

test('records large Pixi selection latency and renderer resource baselines', async () => {
  const fixture = process.env.LANTERN_GRAPH_MAP ? 'real' : 'large';
  const startupMs: number[] = [];
  for (let index = 0; index < 2; index += 1) {
    const fresh = await launchGraphHarness(fixture);
    startupMs.push(fresh.startupMs);
    await closeGraphHarness(fresh);
    expect(fresh.errors).toEqual([]);
  }
  const harness = await launchGraphHarness(fixture);
  startupMs.push(harness.startupMs);
  let caught: unknown;
  try {
    const page = harness.page;
    const session = await harness.app.context().newCDPSession(page);
    await session.send('Performance.enable');
    const before = await session.send('Performance.getMetrics');
    const node = page.locator('.lt-pixi-node-access').nth(600);
    const samples: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      samples.push(await node.evaluate(async (button: HTMLButtonElement) => {
        const startedAt = performance.now();
        button.click();
        await new Promise<void>((resolve) => {
          const settled = () => document.documentElement.dataset.graphTransition === 'settled'
            ? requestAnimationFrame(() => resolve())
            : requestAnimationFrame(settled);
          requestAnimationFrame(settled);
        });
        return performance.now() - startedAt;
      }));
      if (index % 2 === 0) await expect(node).toHaveAttribute('aria-pressed', 'true');
      else await expect(node).toHaveAttribute('aria-pressed', 'false');
    }
    const after = await session.send('Performance.getMetrics');
    const rawSamples = samples.slice(1);
    const sorted = [...rawSamples].sort((a, b) => a - b);
    const sortedStartup = [...startupMs].sort((a, b) => a - b);
    const sourceHash = process.env.LANTERN_GRAPH_MAP
      ? createHash('sha256').update(await readFile(process.env.LANTERN_GRAPH_MAP)).digest('hex')
      : null;
    const metric = (name: string, values: typeof after.metrics) => values.find((entry) => entry.name === name)?.value ?? null;
    const report = {
      schema: 1,
      renderer: 'pixi-webgl',
      fixture: { name: fixture, nodes: await page.locator('.lt-pixi-node-access').count(), source: fixture === 'real' ? process.env.LANTERN_GRAPH_MAP : 'synthetic', sha256: sourceHash },
      environment: {
        platform: process.platform,
        arch: process.arch,
        electron: await harness.app.evaluate(() => process.versions.electron),
        chromium: await page.evaluate(() => navigator.userAgent),
        viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
        devicePixelRatio: await page.evaluate(() => devicePixelRatio),
        cpu: cpus()[0]?.model ?? 'unknown',
        logicalCpus: cpus().length,
        totalMemoryBytes: totalmem(),
        gpu: await harness.app.evaluate(({ app }) => app.getGPUInfo('basic')),
      },
      startup: {
        name: 'Electron launch to settled graph',
        samplesMs: startupMs,
        medianMs: sortedStartup[1],
        worstMs: sortedStartup[2],
      },
      interaction: {
        name: 'semantic activation to settled Pixi frame',
        warmupDiscarded: samples[0],
        samplesMs: rawSamples,
        medianMs: sorted[Math.floor(sorted.length / 2)],
        p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        worstMs: sorted.at(-1),
      },
      resources: {
        jsHeapUsedBeforeBytes: metric('JSHeapUsedSize', before.metrics),
        jsHeapUsedAfterBytes: metric('JSHeapUsedSize', after.metrics),
        domNodesAfter: metric('Nodes', after.metrics),
        layoutCountDelta: (metric('LayoutCount', after.metrics) ?? 0) - (metric('LayoutCount', before.metrics) ?? 0),
      },
    };
    const output = path.resolve(`test-results/graph-performance/pixi-${fixture}-baseline.json`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
    expect(report.interaction.samplesMs).toHaveLength(5);
    expect(report.resources.domNodesAfter).toBeGreaterThan(100);
    expect(await page.locator('html').getAttribute('data-graph-renderer')).toBe('webgl');
  } catch (error) {
    caught = error;
  } finally {
    await closeGraphHarness(harness);
  }
  expect(harness.errors).toEqual([]);
  if (caught) throw caught;
});
