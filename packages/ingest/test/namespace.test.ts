import { describe, it, expect } from 'vitest';
import { inferNamespace } from '../src/namespace.js';

describe('inferNamespace', () => {
  it('maps memory paths', () => {
    expect(inferNamespace('/home/x/.openclaw/workspace/memory/2026-01-01.md')).toBe('memory');
  });
  it('maps session paths', () => {
    expect(inferNamespace('/x/sessions/abc.json')).toBe('sessions');
  });
  it('maps projects', () => {
    expect(inferNamespace('/x/projects/snip/README.md')).toBe('projects');
  });
});
