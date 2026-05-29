import { describe, it, expect } from 'vitest';
import { loadMarkdown } from '../src/loaders/markdown.js';
import { loadJson } from '../src/loaders/json.js';
import { writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('loaders', () => {
  it('reads markdown with frontmatter', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-'));
    const file = join(dir, 'a.md');
    await writeFile(file, '---\ntitle: Hello\n---\nbody here', 'utf8');
    const { doc, body } = await loadMarkdown(file);
    expect(doc.title).toBe('Hello');
    expect(body.trim()).toBe('body here');
  });
  it('pretty-prints json', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cm-'));
    const file = join(dir, 'b.json');
    await writeFile(file, '{"a":1,"b":2}', 'utf8');
    const { body } = await loadJson(file);
    expect(body).toContain('\n');
  });
});
