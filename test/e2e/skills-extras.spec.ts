import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchSkillsHarness } from './support/skills-extras-harness';
import type { SkillsHarness } from './support/skills-extras-harness';

const HOME_SKILLS = ['typescript', 'biome', 'code-principles', 'react-spa-forms', 'zod-schemas'];
const PROJECT_SKILLS = ['electron-ui-design', 'frontend-design', 'northwind-billing', 'electron-ipc', 'electron-security'];

async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.mouse.move(2, 790);
  const file = `${name}.png`;
  await page.screenshot({ path: process.env.LANTERN_SKILLS_SHOTS ? path.join(process.env.LANTERN_SKILLS_SHOTS, file) : testInfo.outputPath(file) });
}

async function openLanternTab(h: SkillsHarness) {
  await h.page.evaluate(() => (window as unknown as { openHarnessSkills: () => void }).openHarnessSkills());
  await h.page.getByRole('tab', { name: 'Lantern skills' }).click();
  await expect(h.page.locator('[data-board]')).toBeVisible();
}

const projectFile = (h: SkillsHarness) => path.join(h.project, '.claude', 'lantern-extensions.json');
const globalFile = (h: SkillsHarness) => path.join(h.home, '.claude', 'lantern-extensions.json');
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

test.describe.serial('Lantern skills tab in a project window', () => {
  let h: SkillsHarness;

  test.beforeAll(async () => {
    h = await launchSkillsHarness({
      project: true,
      homeSkills: HOME_SKILLS,
      projectSkills: PROJECT_SKILLS,
      globalExtras: { delegate: ['typescript', 'code-principles'], reviewer: ['code-principles'] },
      projectExtras: { delegate: ['electron-ui-design', 'northwind-billing', 'retired-skill'], orchestrator: ['frontend-design'] },
    });
  });

  test.afterAll(async () => {
    const errors = h.errors;
    await h.close();
    expect(errors).toEqual([]);
  });

  test('shows the role selector, the attached list with scope badges and the attachable list', async ({}, testInfo) => {
    await openLanternTab(h);
    const { page } = h;
    await expect(page.getByRole('radio', { name: /Delegate/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('[data-extra]')).toHaveCount(5);
    await expect(page.locator('[data-extra="typescript"] .sk-scope')).toHaveText('Global');
    await expect(page.locator('[data-extra="electron-ui-design"] .sk-scope')).toHaveText('This project');
    await expect(page.locator('[data-extra="retired-skill"]')).toContainText('Not installed');
    await expect(page.locator('[data-pick="typescript"]')).toContainText('Attached');
    await shot(page, testInfo, '01-delegate-project');
  });

  test('switches role with the selector and shows an empty list for a role with nothing attached', async ({}, testInfo) => {
    const { page } = h;
    await page.getByRole('radio', { name: /Orchestrator/ }).click();
    await expect(page.locator('[data-extra]')).toHaveCount(1);
    await shot(page, testInfo, '02-orchestrator-project');
    await page.getByRole('radio', { name: /Reviewer/ }).click();
    await expect(page.locator('[data-extra="code-principles"] .sk-scope')).toHaveText('Global');
    await shot(page, testInfo, '03-reviewer-project');
    await page.getByRole('radio', { name: /Delegate/ }).click();
  });

  test('opens the built-in skills and walks the attached list with the arrow keys', async ({}, testInfo) => {
    const { page } = h;
    await page.locator('[data-builtin-toggle]').click();
    await expect(page.locator('[data-builtin-toggle]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-switch="lantern-commit"]')).toBeVisible();
    await shot(page, testInfo, '09-built-in-open');
    await page.locator('[data-builtin-toggle]').click();
    await page.locator('[data-extra]').first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[data-extra="code-principles"]')).toBeFocused();
    await shot(page, testInfo, '10-keyboard-focus');
  });

  test('searches the attachable skills and explains a built-in one', async ({}, testInfo) => {
    const { page } = h;
    await page.keyboard.press('/');
    await expect(page.locator('.sk-search')).toBeFocused();
    await page.keyboard.type('e');
    await shot(page, testInfo, '04-search-results');
    await page.locator('.sk-search').fill('lantern');
    await expect(page.locator('[data-pick="lantern-commit"]')).toHaveAttribute('aria-disabled', 'true');
    await shot(page, testInfo, '05-search-built-in');
    await page.locator('.sk-search').fill('');
  });

  test('attaches with Enter in the search, to this project by default, and writes only the project file', async ({}, testInfo) => {
    const { page } = h;
    await page.locator('.sk-search').fill('electron-ipc');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-extra="electron-ipc"] .sk-scope')).toHaveText('This project');
    expect(readJson(projectFile(h)).delegate).toEqual(['electron-ui-design', 'northwind-billing', 'retired-skill', 'electron-ipc']);
    expect(readJson(globalFile(h)).delegate).toEqual(['typescript', 'code-principles']);
    await page.locator('.sk-search').fill('');
    await shot(page, testInfo, '06-after-attach');
  });

  test('attaches globally after the scope is switched, moves a skill between scopes and detaches with Delete', async () => {
    const { page } = h;
    await page.getByRole('radio', { name: 'Global' }).click();
    await page.locator('[data-pick="biome"]').click();
    await expect(page.locator('[data-extra="biome"] .sk-scope')).toHaveText('Global');
    expect(readJson(globalFile(h)).delegate).toEqual(['typescript', 'code-principles', 'biome']);
    await page.locator('[data-extra="biome"] .sk-scope').click();
    await expect(page.locator('[data-extra="biome"] .sk-scope')).toHaveText('This project');
    expect(readJson(globalFile(h)).delegate).toEqual(['typescript', 'code-principles']);
    expect(readJson(projectFile(h)).delegate).toContain('biome');
    await page.locator('[data-extra="biome"]').focus();
    await page.keyboard.press('Delete');
    await expect(page.locator('[data-extra="biome"]')).toHaveCount(0);
    expect(readJson(projectFile(h)).delegate).not.toContain('biome');
  });

  test('keeps the project file out of git', async () => {
    const exclude = fs.readFileSync(path.join(h.project, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.split('\n')).toContain('.claude/lantern-extensions.json');
  });

  test('stacks the columns at a narrow window and keeps everything inside', async ({}, testInfo) => {
    const { page } = h;
    await page.evaluate(() => document.getElementById('skills-modal')!.querySelector<HTMLElement>('.modal-card')!.style.setProperty('width', '440px'));
    await shot(page, testInfo, '07-narrow');
    const columns = await page.locator('.sk-col').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left));
    expect(new Set(columns).size).toBe(1);
    const overflow = await page.locator('#sk-body').evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe('Lantern skills tab in the main window', () => {
  test('has only the global scope', async ({}, testInfo) => {
    const h = await launchSkillsHarness({ project: false, homeSkills: HOME_SKILLS, projectSkills: [], globalExtras: { delegate: ['typescript'] } });
    try {
      await openLanternTab(h);
      await expect(h.page.locator('.sk-scope')).toHaveCount(0);
      await expect(h.page.locator('.sk-scope-pick')).toHaveCount(0);
      await h.page.locator('[data-pick="biome"]').click();
      await expect(h.page.locator('[data-extra="biome"]')).toBeVisible();
      expect(readJson(globalFile(h)).delegate).toEqual(['typescript', 'biome']);
      expect(fs.existsSync(projectFile(h))).toBe(false);
      await shot(h.page, testInfo, '08-main-window');
      await h.page.getByRole('radio', { name: /Orchestrator/ }).click();
      await expect(h.page.locator('[data-col="attached"] .sk-empty')).toBeVisible();
      await shot(h.page, testInfo, '11-empty-role');
      await h.page.locator('.sk-search').fill('zzz');
      await expect(h.page.locator('[data-col="candidates"] .sk-empty')).toBeVisible();
      await shot(h.page, testInfo, '12-no-match');
      expect(h.errors).toEqual([]);
    } finally {
      await h.close();
    }
  });
});

const linkedSkill = (h: SkillsHarness, name: string) => path.join(h.project, '.claude', 'skills', name);

async function openSkillsWindow(h: SkillsHarness) {
  await h.page.evaluate(() => (window as unknown as { openHarnessSkills: () => void }).openHarnessSkills());
}

test.describe.serial('the skill linker is the skills catalogue', () => {
  let h: SkillsHarness;

  test.beforeAll(async () => {
    h = await launchSkillsHarness({
      project: true,
      homeSkills: [],
      projectSkills: ['northwind-billing'],
      skillRepo: true,
      saveLinker: true,
      globalExtras: { delegate: ['electron-ipc', 'electron-security'] },
    });
    expect(fs.existsSync(path.join(h.userData, 'ccm-skills.json'))).toBe(false);
  });

  test.afterAll(async () => {
    const errors = h.errors;
    await h.close();
    expect(errors).toEqual([]);
  });

  test('the first tab lists the linker roles with their skills and links one on a click', async ({}, testInfo) => {
    await openSkillsWindow(h);
    const { page } = h;
    await expect(page.locator('.sk-role .sk-role-name')).toHaveText(['core', 'desktop', 'research']);
    await expect(page.locator('.sk-name', { hasText: 'web-research' })).toBeVisible();
    await expect(page.getByText(/Linking skills needs your skill linker/)).toHaveCount(0);
    await shot(page, testInfo, '13-project-roles-from-linker');
    await page.locator('.sk-row', { hasText: 'web-research' }).click();
    await expect(page.locator('.sk-row.on', { hasText: 'web-research' })).toBeVisible();
    expect(fs.lstatSync(linkedSkill(h, 'web-research')).isSymbolicLink()).toBe(true);
    await page.locator('.sk-row.on', { hasText: 'web-research' }).click();
    await expect(page.locator('.sk-row.on', { hasText: 'web-research' })).toHaveCount(0);
    expect(fs.existsSync(linkedSkill(h, 'web-research'))).toBe(false);
  });

  test('searching "web" on the Lantern tab finds web-research and marks it as not installed', async ({}, testInfo) => {
    const { page } = h;
    await page.getByRole('tab', { name: 'Lantern skills' }).click();
    await expect(page.locator('[data-board]')).toBeVisible();
    await page.locator('.sk-search').fill('web');
    const pick = page.locator('[data-pick="web-research"]');
    await expect(pick).toBeVisible();
    await expect(pick).toContainText('Not installed');
    await expect(pick).toContainText('Attach and link');
    await shot(page, testInfo, '14-search-web-not-installed');
  });

  test('attaching a skill that is not installed links it into the project at the same time', async () => {
    const { page } = h;
    await page.locator('[data-pick="web-research"]').click();
    const attached = page.locator('[data-extra="web-research"]');
    await expect(attached).toBeVisible();
    await expect(attached).not.toContainText('Not installed');
    expect(fs.lstatSync(linkedSkill(h, 'web-research')).isSymbolicLink()).toBe(true);
    expect(readJson(projectFile(h)).delegate).toEqual(['web-research']);
    await page.locator('.sk-search').fill('');
  });

  test('an attached skill that is not installed can be linked to the project', async ({}, testInfo) => {
    const { page } = h;
    const row = page.locator('[data-extra="electron-ipc"]');
    await expect(row).toContainText('Not installed');
    await shot(page, testInfo, '15-attached-not-installed');
    await row.locator('[data-link]').click();
    await expect(row).not.toContainText('Not installed');
    await expect(row.locator('[data-link]')).toHaveCount(0);
    expect(fs.lstatSync(linkedSkill(h, 'electron-ipc')).isSymbolicLink()).toBe(true);
    await expect(page.locator('[data-extra="electron-security"]')).toContainText('Not installed');
  });

  test('the Project skills tab shows the skills linked from the Lantern tab', async () => {
    const { page } = h;
    await page.getByRole('tab', { name: 'Project skills' }).click();
    await expect(page.locator('.sk-row.on', { hasText: 'web-research' })).toBeVisible();
    await expect(page.locator('.sk-row.on', { hasText: 'electron-ipc' })).toBeVisible();
  });

  test('the Skill linker tab says in plain words that the linker is ready and what it holds', async () => {
    const { page } = h;
    await page.getByRole('tab', { name: 'Skill linker' }).click();
    await expect(page.locator('[data-linker-state]')).toHaveText(`Skill linker ready: ${h.linker} (5 skills in 3 roles)`);
  });
});

test.describe('setting the skill linker on the first tab', () => {
  test('with no linker and no repo the tab asks for the linker path and fills in place after Save', async ({}, testInfo) => {
    const h = await launchSkillsHarness({ project: true, homeSkills: [], projectSkills: [], skillRepo: true });
    try {
      await openSkillsWindow(h);
      const { page } = h;
      await expect(page.getByText(/Linking skills needs your skill linker/)).toBeVisible();
      await expect(page.locator('.sk-role .sk-role-name')).toHaveCount(0);
      await shot(page, testInfo, '16-project-needs-linker');
      await page.locator('[data-skill-linker="path"]').fill(h.linker);
      await page.getByRole('button', { name: 'Save path' }).click();
      await expect(page.locator('.sk-role .sk-role-name')).toHaveText(['core', 'desktop', 'research']);
      await expect(page.locator('.sk-name', { hasText: 'web-research' })).toBeVisible();
      await expect(page.getByText(/Linking skills needs your skill linker/)).toHaveCount(0);
      expect(readJson(globalFile(h)).skillLinker).toBe(h.linker);
      expect(fs.existsSync(path.join(h.userData, 'ccm-skills.json'))).toBe(false);
      await page.getByRole('tab', { name: 'Lantern skills' }).click();
      await page.locator('.sk-search').fill('web');
      await expect(page.locator('[data-pick="web-research"]')).toBeVisible();
      expect(h.errors).toEqual([]);
    } finally {
      await h.close();
    }
  });

  test('saving a path that is no linker keeps the notice and names the problem', async () => {
    const h = await launchSkillsHarness({ project: true, homeSkills: [], projectSkills: [], skillRepo: true });
    try {
      await openSkillsWindow(h);
      const { page } = h;
      await page.locator('[data-skill-linker="path"]').fill(path.join(h.home, 'no-such-linker'));
      await page.getByRole('button', { name: 'Save path' }).click();
      await expect(page.locator('[data-linker-state="invalid"]')).toContainText('no-such-linker');
      await expect(page.locator('.sk-role .sk-role-name')).toHaveCount(0);
    } finally {
      await h.close();
    }
  });
});
