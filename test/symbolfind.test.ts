import { describe, expect, it } from 'vitest';
import { findSymbolLine } from '../src/renderer/lib/symbolfind';

const lines = (...l: string[]) => l.join('\n');

describe('findSymbolLine', () => {
  it('finds a TS exported function far below the top, never line 1', () => {
    const text = lines("import { x } from './x';", "import { buildPrompt as bp } from './y';", '', 'const a = 1;', 'export async function buildPrompt(input: string) {', '  return input;', '}');
    expect(findSymbolLine(text, 'buildPrompt')).toBe(5);
  });

  it('prefers the declaration over an earlier comment mention', () => {
    const text = lines('// buildPrompt is the thing that builds prompts', '/* see buildPrompt */', 'const z = 2;', 'function buildPrompt() {}');
    expect(findSymbolLine(text, 'buildPrompt')).toBe(4);
  });

  it('prefers the declaration over an earlier call site', () => {
    const text = lines('run(buildPrompt());', 'buildPrompt();', 'export const buildPrompt = () => 1;');
    expect(findSymbolLine(text, 'buildPrompt')).toBe(3);
  });

  it('handles TSX components, interfaces, types and enums', () => {
    const text = lines("import React from 'react';", 'export interface Props { a: number }', 'export type Mode = "a" | "b";', 'export enum Color { Red }', 'export default function Panel({ a }: Props) {', '  return <div />;', '}');
    expect(findSymbolLine(text, 'Props')).toBe(2);
    expect(findSymbolLine(text, 'Mode')).toBe(3);
    expect(findSymbolLine(text, 'Color')).toBe(4);
    expect(findSymbolLine(text, 'Panel')).toBe(5);
  });

  it('handles JS assignments and exports', () => {
    const text = lines("'use strict';", 'const fs = require("fs");', 'module.exports.load = function () {};', 'let counter = 0;', 'exports.save = (a) => a;');
    expect(findSymbolLine(text, 'load')).toBe(3);
    expect(findSymbolLine(text, 'counter')).toBe(4);
    expect(findSymbolLine(text, 'save')).toBe(5);
  });

  it('handles Python def and class', () => {
    const text = lines('import os', '', 'class Store:', '    def get(self, k):', '        return k', '', 'async def fetch_all():', '    pass');
    expect(findSymbolLine(text, 'Store')).toBe(3);
    expect(findSymbolLine(text, 'get')).toBe(4);
    expect(findSymbolLine(text, 'fetch_all')).toBe(7);
  });

  it('handles Go funcs, receiver methods and structs', () => {
    const text = lines('package main', '', 'type Server struct {', '}', '', 'func (s *Server) Start() error {', '  return nil', '}', '', 'func NewServer() *Server {');
    expect(findSymbolLine(text, 'Server')).toBe(3);
    expect(findSymbolLine(text, 'Start')).toBe(6);
    expect(findSymbolLine(text, 'NewServer')).toBe(10);
  });

  it('handles Swift and Kotlin style declarations', () => {
    const text = lines('import Foundation', '', 'public final class Loader {', '    private static func make() {}', '    override func load() {}', '}', '', 'suspend fun fetchUser(id: Int): User {', 'data class User(val id: Int)', 'protocol Runner {}');
    expect(findSymbolLine(text, 'Loader')).toBe(3);
    expect(findSymbolLine(text, 'make')).toBe(4);
    expect(findSymbolLine(text, 'load')).toBe(5);
    expect(findSymbolLine(text, 'fetchUser')).toBe(8);
    expect(findSymbolLine(text, 'User')).toBe(9);
    expect(findSymbolLine(text, 'Runner')).toBe(10);
  });

  it('finds Rust fn and a class method, not its call sites', () => {
    const text = lines('pub fn parse(s: &str) {}', '', 'class Repo {', '  constructor() { this.init(); }', '  init() {', '    this.load();', '  }', '  async load(): Promise<void> {', '  }', '}');
    expect(findSymbolLine(text, 'parse')).toBe(1);
    expect(findSymbolLine(text, 'init')).toBe(5);
    expect(findSymbolLine(text, 'load')).toBe(8);
  });

  it('resolves Class.method by the method, falling back to the class', () => {
    const text = lines('class Repo {', '  save(x) {', '  }', '}');
    expect(findSymbolLine(text, 'Repo.save')).toBe(2);
    expect(findSymbolLine(text, 'Repo.missing')).toBe(1);
  });

  it('falls back to the first whole-word occurrence and ignores partial words', () => {
    const text = lines('const rebuildPrompt = 1;', 'call(prompt);', 'x = prompt + 1');
    expect(findSymbolLine(text, 'prompt')).toBe(2);
  });

  it('returns null when absent', () => {
    expect(findSymbolLine('const a = 1;', 'nope')).toBeNull();
    expect(findSymbolLine('const a = 1;', '')).toBeNull();
  });
});
