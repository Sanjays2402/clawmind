import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compilePattern,
  parseIgnoreFile,
  loadIgnoreSet,
  isIgnored,
  filterIgnored,
} from '../src/ignore.js';
import { discoverFiles } from '../src/pipeline.js';

describe('compilePattern', () => {
  it('handles bare names (matches in any directory)', () => {
    const { re } = compilePattern('node_modules');
    expect(re.test('node_modules')).toBe(true);
    expect(re.test('a/b/node_modules')).toBe(true);
    expect(re.test('a/b/node_modules/foo')).toBe(true);
    expect(re.test('notnode_modules')).toBe(false);
  });

  it('anchors patterns that start with /', () => {
    const { re } = compilePattern('/build');
    expect(re.test('build')).toBe(true);
    expect(re.test('a/build')).toBe(false);
  });

  it('supports ** across separators', () => {
    const { re } = compilePattern('**/*.log');
    expect(re.test('a.log')).toBe(true);
    expect(re.test('a/b/c.log')).toBe(true);
    expect(re.test('a.txt')).toBe(false);
  });

  it('flags directory-only patterns', () => {
    const { dirOnly, re } = compilePattern('cache/');
    expect(dirOnly).toBe(true);
    expect(re.test('cache')).toBe(true);
    expect(re.test('a/cache')).toBe(true);
  });

  it('* does not cross /', () => {
    const { re } = compilePattern('a/*.md');
    expect(re.test('a/foo.md')).toBe(true);
    expect(re.test('a/b/foo.md')).toBe(false);
  });
});

describe('parseIgnoreFile', () => {
  it('skips comments and blank lines, handles negation', () => {
    const rules = parseIgnoreFile('# top\n\n*.tmp\n!keep.tmp\n', '/root');
    expect(rules).toHaveLength(2);
    expect(rules[0]!.negate).toBe(false);
    expect(rules[1]!.negate).toBe(true);
  });
});

describe('isIgnored / filterIgnored / discoverFiles', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'cm-ign-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('ignores files matched by root .clawmindignore and respects negation', async () => {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'a.md'), '# a');
    await writeFile(join(root, 'docs', 'a.tmp'), 'x');
    await writeFile(join(root, 'docs', 'keep.tmp'), 'keep');
    await writeFile(join(root, '.clawmindignore'), '*.tmp\n!keep.tmp\n');

    const files = [
      join(root, 'docs', 'a.md'),
      join(root, 'docs', 'a.tmp'),
      join(root, 'docs', 'keep.tmp'),
    ];
    const kept = await filterIgnored(root, files);
    expect(kept).toContain(join(root, 'docs', 'a.md'));
    expect(kept).toContain(join(root, 'docs', 'keep.tmp'));
    expect(kept).not.toContain(join(root, 'docs', 'a.tmp'));
  });

  it('nested .clawmindignore overrides ancestor (negation)', async () => {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, '.clawmindignore'), '*.md\n');
    await writeFile(join(root, 'src', '.clawmindignore'), '!notes.md\n');
    await writeFile(join(root, 'src', 'notes.md'), 'n');
    await writeFile(join(root, 'src', 'other.md'), 'o');

    const set = await loadIgnoreSet(root, [
      join(root, 'src', 'notes.md'),
      join(root, 'src', 'other.md'),
    ]);
    expect(isIgnored(set, root, join(root, 'src', 'notes.md'))).toBe(false);
    expect(isIgnored(set, root, join(root, 'src', 'other.md'))).toBe(true);
  });

  it('discoverFiles filters via .clawmindignore', async () => {
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'docs', 'a.md'), '# a');
    await writeFile(join(root, 'docs', 'secret.md'), 'oops');
    await writeFile(join(root, '.clawmindignore'), 'secret.md\n');

    const got = await discoverFiles(root);
    const names = got.map((p) => p.split('/').pop());
    expect(names).toContain('a.md');
    expect(names).not.toContain('secret.md');
  });

  it('returns input unchanged when no ignore file exists', async () => {
    await writeFile(join(root, 'a.md'), '# a');
    const kept = await filterIgnored(root, [join(root, 'a.md')]);
    expect(kept).toEqual([join(root, 'a.md')]);
  });
});
