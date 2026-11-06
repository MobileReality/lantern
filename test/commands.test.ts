// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

let commands: typeof import('../src/renderer/commands');

beforeEach(async () => {
  vi.resetModules();
  commands = await import('../src/renderer/commands');
});

describe('renderer command handlers', () => {
  it('runs a registered handler and reports a hit', () => {
    const run = vi.fn();
    commands.registerCommand('settings.open', run);
    expect(commands.runCommand('settings.open')).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });

  it('reports a miss for an id without a handler or outside the table', () => {
    expect(commands.runCommand('settings.open')).toBe(false);
    expect(commands.runCommand('nope.nothing')).toBe(false);
  });

  it('lists available commands in table order', () => {
    commands.registerCommand('project.new', vi.fn());
    commands.registerCommand('settings.open', vi.fn());
    expect(commands.availableCommands()).toEqual(['settings.open', 'project.new']);
  });

  it('unregister stops listing and running the command', () => {
    const run = vi.fn();
    const unregister = commands.registerCommand('settings.open', run);
    unregister();
    expect(commands.availableCommands()).toEqual([]);
    expect(commands.runCommand('settings.open')).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('a second registration replaces the first, and the stale unregister leaves it in place', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unregisterFirst = commands.registerCommand('settings.open', first);
    commands.registerCommand('settings.open', second);
    unregisterFirst();
    expect(commands.runCommand('settings.open')).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
