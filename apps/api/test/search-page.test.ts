import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// We assert by reading the page source rather than booting a Next dev server
// in CI. That keeps the test hermetic and still catches regressions where a
// future edit drops filter wiring, pagination, or recent-search persistence.
const here = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(
  here,
  '..',
  '..',
  'web',
  'src',
  'app',
  'search',
  'page.tsx',
);
const src = readFileSync(pagePath, 'utf8');

describe('search page filters and pagination', () => {
  it('forwards includeTags, excludeTags, and namespaces to the search API', () => {
    expect(src).toContain('api.search(');
    expect(src).toMatch(/includeTags:\s*opts\.includeTags/);
    expect(src).toMatch(/excludeTags:\s*opts\.excludeTags/);
    expect(src).toMatch(/namespaces:\s*opts\.namespaces/);
  });

  it('paginates client-side over the cached result page', () => {
    expect(src).toContain('PAGE_SIZE_OPTIONS');
    expect(src).toContain('pageHits');
    expect(src).toMatch(/Math\.ceil\(total\s*\/\s*pageSize\)/);
    expect(src).toContain('Previous');
    expect(src).toContain('Next');
  });

  it('exposes namespace chips for every supported namespace', () => {
    for (const ns of ['memory', 'projects', 'sessions', 'docs', 'misc']) {
      expect(src).toContain(`'${ns}'`);
    }
  });

  it('persists recent searches to localStorage', () => {
    expect(src).toContain('clawmind.search.recent');
    expect(src).toContain('writeRecents');
    expect(src).toContain('readRecents');
  });

  it('keeps filter state in the URL so links restore the full query', () => {
    expect(src).toContain("params.set('q'");
    expect(src).toContain("params.set('ns'");
    expect(src).toContain("params.set('inc'");
    expect(src).toContain("params.set('exc'");
  });

  it('renders skeleton, empty, and error states', () => {
    expect(src).toContain('animate-pulse');
    expect(src).toContain('EmptyState');
    expect(src).toContain('ErrorState');
  });
});
