import { describe, it, expect } from 'vitest';
import {
  collectionToCsv,
  collectionToJson,
  collectionToMarkdown,
} from '../src/services/collections-export.js';
import type { Collection } from '../src/services/collections.js';
import type { SavedItem } from '../src/services/saved.js';

function c1(over: Partial<Collection> = {}): Collection {
  return {
    id: 'c1',
    userId: 'u1',
    name: 'Onboarding playbooks',
    description: 'Stuff for new hires',
    color: 'violet',
    createdAt: 1700000000000,
    updatedAt: 1700000050000,
    ...over,
  };
}

function s1(over: Partial<SavedItem> = {}): SavedItem {
  return {
    id: 's1',
    userId: 'u1',
    title: 'Ingest activity',
    query: 'recent ingest errors',
    tags: ['ops'],
    createdAt: 1700000000000,
    updatedAt: 1700000060000,
    ...over,
  };
}

describe('collections-export', () => {
  it('JSON envelope carries collection metadata and item rows', () => {
    const json = collectionToJson(c1(), [s1(), s1({ id: 's2', title: 'Other' })]);
    expect(json.version).toBe(1);
    expect(json.count).toBe(2);
    expect(json.collection.id).toBe('c1');
    expect(json.collection.name).toBe('Onboarding playbooks');
    expect(json.collection.color).toBe('violet');
    expect(json.collection.createdAtIso).toBe(new Date(1700000000000).toISOString());
    expect(json.items.map((i) => i.id)).toEqual(['s1', 's2']);
    expect(json.items[0].tags).toEqual(['ops']);
  });

  it('JSON envelope works for empty collections', () => {
    const json = collectionToJson(c1(), []);
    expect(json.count).toBe(0);
    expect(json.items).toEqual([]);
  });

  it('CSV prefixes collection metadata as comments before the saved-search header', () => {
    const csv = collectionToCsv(c1({ name: 'Has, comma\nand newline' }), [s1()]);
    const lines = csv.split(/\r\n/);
    expect(lines[0]).toBe('# collection: Has, comma and newline');
    expect(lines[1]).toBe('# collection_id: c1');
    expect(lines[2]).toMatch(/^# exported_at: \d{4}-\d{2}-\d{2}T/);
    expect(lines[3]).toBe('id,created_iso,updated_iso,title,query,tags');
    expect(lines[4]).toContain('Ingest activity');
  });

  it('Markdown leads with collection name, description, and item count', () => {
    const md = collectionToMarkdown(c1(), [s1()]);
    expect(md).toContain('# Onboarding playbooks');
    expect(md).toContain('Stuff for new hires');
    expect(md).toContain('1 saved search');
    expect(md).toContain('color: violet');
    expect(md).toContain('## Ingest activity');
    expect(md).toContain('#ops');
    // The shared saved-search top heading must not appear twice.
    expect(md).not.toContain('# ClawMind saved searches');
  });

  it('Markdown without description skips the description block', () => {
    const md = collectionToMarkdown(c1({ description: '' }), [s1()]);
    expect(md).toContain('# Onboarding playbooks');
    expect(md).not.toContain('Stuff for new hires');
  });

  it('Markdown shows an empty-collection message instead of the saved-search placeholder', () => {
    const md = collectionToMarkdown(c1(), []);
    expect(md).toContain('0 saved searches');
    expect(md).toContain('_This collection is empty._');
    expect(md).not.toContain('_No saved searches yet._');
  });
});
