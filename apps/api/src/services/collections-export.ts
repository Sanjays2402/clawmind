import type { Collection } from './collections.js';
import type { SavedItem } from './saved.js';
import { savedToCsv, savedToJson, savedToMarkdown } from './saved-export.js';

// Per-collection export. Bundles the collection metadata together with the
// hydrated saved-search rows so a caller can hand off "Onboarding playbooks"
// as a single file without stitching two API calls together. Reuses the
// saved-search formatters for the row payload so the JSON envelope and CSV
// columns stay consistent with /saved/export.<fmt> and downstream tooling
// only learns one shape.

export interface CollectionJsonExport {
  version: 1;
  exportedAt: number;
  collection: {
    id: string;
    name: string;
    description: string;
    color: string;
    createdAt: number;
    createdAtIso: string;
    updatedAt: number;
    updatedAtIso: string;
  };
  count: number;
  items: ReturnType<typeof savedToJson>['items'];
}

export function collectionToJson(collection: Collection, items: SavedItem[]): CollectionJsonExport {
  const inner = savedToJson(items);
  return {
    version: 1,
    exportedAt: inner.exportedAt,
    collection: {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      color: collection.color,
      createdAt: collection.createdAt,
      createdAtIso: new Date(collection.createdAt).toISOString(),
      updatedAt: collection.updatedAt,
      updatedAtIso: new Date(collection.updatedAt).toISOString(),
    },
    count: inner.count,
    items: inner.items,
  };
}

// CSV gets a comment-style preface so spreadsheets that ignore lines
// starting with '#' still get clean headers, while a human eyeballing the
// file can see which collection it came from.
export function collectionToCsv(collection: Collection, items: SavedItem[]): string {
  const safeName = collection.name.replace(/[\r\n]+/g, ' ');
  const preface =
    `# collection: ${safeName}\r\n` +
    `# collection_id: ${collection.id}\r\n` +
    `# exported_at: ${new Date().toISOString()}\r\n`;
  return preface + savedToCsv(items);
}

export function collectionToMarkdown(collection: Collection, items: SavedItem[]): string {
  const header: string[] = [
    `# ${collection.name}`,
    '',
  ];
  if (collection.description) {
    header.push(collection.description, '');
  }
  const meta = `_${items.length} ${items.length === 1 ? 'saved search' : 'saved searches'} - color: ${collection.color}_`;
  header.push(meta, '', '---', '');
  // Drop the saved-search top-level title since the collection name owns
  // that slot. Keep the per-item sections from the shared formatter.
  const body = savedToMarkdown(items)
    .replace(/^# ClawMind saved searches\n\n[^\n]*\n\n/, '')
    .replace(/^_No saved searches yet\._\n/, '_This collection is empty._\n');
  return header.join('\n') + body;
}
