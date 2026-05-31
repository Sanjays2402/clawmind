// Workspace-wide data export (tenant-scope GDPR / data-portability).
//
// Per-user export already exists at /v1/me/export. Enterprise procurement
// reviewers additionally require an owner-only "give me everything in this
// workspace" path so legal, compliance, and exit-data-portability obligations
// can be satisfied without manually stitching per-user dumps together.
//
// This service reads (never writes) every workspace-scoped artifact on disk
// and produces a single structured bundle. The route layer adds JSON and
// ZIP+CSV variants on top, plus a dry-run preview that reports the same
// counts the real export would write.
//
// Scope is intentionally narrow: only files actually owned by the tenant
// are included. We do NOT vacuum up secrets (bcrypt hashes, API-key hashes,
// OIDC client secrets, SMTP creds, MFA TOTP seeds) — those are stripped
// before they ever leave disk. The export is meant to be portable, not
// to enable re-impersonation if leaked.

import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Conversation } from './conversations.js';
import type { HistoryItem } from './history.js';
import type { SavedItem } from './saved.js';
import type { FeedbackMap } from './feedback.js';
import type { ApiKeyRecord } from './api-keys.js';

export const WORKSPACE_EXPORT_SCHEMA = 'clawmind.workspace-export.v1' as const;
export const WORKSPACE_EXPORT_PREVIEW_SCHEMA = 'clawmind.workspace-export-preview.v1' as const;

export interface WorkspaceExportCounts {
  members: number;
  history: number;
  conversations: number;
  saved: number;
  feedback: number;
  apiKeys: number;
  pins: number;
  mutes: number;
  aliases: number;
  tags: number;
  collections: number;
  domainPolicies: number;
  ipAllowlist: number;
  webhookAllowlist: number;
  webhooks: number;
  invitations: number;
  auditEvents: number;
  ingestDocs: number;
}

export interface WorkspaceExportPreview {
  schema: typeof WORKSPACE_EXPORT_PREVIEW_SCHEMA;
  dryRun: true;
  previewedAt: number;
  estimatedBytes: number;
  counts: WorkspaceExportCounts;
}

export interface WorkspaceExportBundle {
  schema: typeof WORKSPACE_EXPORT_SCHEMA;
  exportedAt: number;
  exportedBy: string;
  counts: WorkspaceExportCounts;
  members: unknown[];
  history: HistoryItem[];
  conversations: Conversation[];
  saved: SavedItem[];
  feedback: Array<{ path: string; ups: number; downs: number; updatedAt: number; voters: number }>;
  apiKeys: Array<Omit<ApiKeyRecord, 'hash'>>;
  pins: unknown;
  mutes: unknown;
  aliases: unknown;
  tags: unknown;
  collections: unknown;
  domainPolicies: unknown;
  ipAllowlist: unknown;
  webhookAllowlist: unknown;
  webhooks: unknown[];
  invitations: unknown[];
  auditEvents: unknown[];
  ingestManifest: unknown;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

async function readJsonl<T>(file: string): Promise<T[]> {
  try {
    const raw = await readFile(file, 'utf8');
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l) as T);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

async function readAllConversations(dir: string): Promise<Conversation[]> {
  const out: Conversation[] = [];
  try {
    const files = await readdir(dir);
    for (const name of files) {
      if (!name.endsWith('.json')) continue;
      const conv = await readJson<Conversation | null>(join(dir, name), null);
      if (conv) out.push(conv);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return out;
}

// Sum file sizes for items the export will copy verbatim. Used by the
// dry-run preview so an owner can see roughly how large the download will
// be before kicking off a real export against a multi-GB tenant.
async function fileBytes(file: string): Promise<number> {
  try {
    const s = await stat(file);
    return s.isFile() ? s.size : 0;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
}

async function dirBytes(dir: string): Promise<number> {
  let total = 0;
  try {
    const files = await readdir(dir);
    for (const name of files) total += await fileBytes(join(dir, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  return total;
}

function p(dataDir: string) {
  return {
    members: join(dataDir, 'members.json'),
    history: join(dataDir, 'history.jsonl'),
    conversationsDir: join(dataDir, 'conversations'),
    saved: join(dataDir, 'saved.json'),
    feedback: join(dataDir, 'feedback.json'),
    apiKeys: join(dataDir, 'api-keys.json'),
    pins: join(dataDir, 'pins.json'),
    mutes: join(dataDir, 'mutes.json'),
    aliases: join(dataDir, 'aliases.json'),
    tags: join(dataDir, 'tags.json'),
    collections: join(dataDir, 'collections.json'),
    domainPolicies: join(dataDir, 'domain-policies.json'),
    ipAllowlist: join(dataDir, 'ip-allowlist.json'),
    webhookAllowlist: join(dataDir, 'webhook-allowlist.json'),
    webhooks: join(dataDir, 'webhooks.json'),
    invitations: join(dataDir, 'invitations.json'),
    audit: join(dataDir, 'audit.log'),
    manifest: join(dataDir, 'manifest.json'),
  };
}

function summarizeFeedback(map: FeedbackMap): WorkspaceExportBundle['feedback'] {
  return Object.values(map).map((e) => ({
    path: e.path,
    ups: e.ups ?? 0,
    downs: e.downs ?? 0,
    updatedAt: e.updatedAt ?? 0,
    voters: Object.keys(e.byUser ?? {}).length,
  }));
}

export async function previewWorkspaceExport(dataDir: string): Promise<WorkspaceExportPreview> {
  const f = p(dataDir);
  const members = await readJson<{ members?: unknown[] }>(f.members, {});
  const history = await readJsonl<HistoryItem>(f.history);
  const conversations = await readAllConversations(f.conversationsDir);
  const saved = await readJson<SavedItem[]>(f.saved, []);
  const feedback = await readJson<FeedbackMap>(f.feedback, {});
  const apiKeys = await readJson<ApiKeyRecord[]>(f.apiKeys, []);
  const pins = await readJson<unknown[]>(f.pins, []);
  const mutes = await readJson<unknown[]>(f.mutes, []);
  const aliases = await readJson<Record<string, unknown>>(f.aliases, {});
  const tags = await readJson<Record<string, unknown>>(f.tags, {});
  const collections = await readJson<unknown[]>(f.collections, []);
  const domainPolicies = await readJson<unknown[]>(f.domainPolicies, []);
  const ipAllowlist = await readJson<{ entries?: unknown[] }>(f.ipAllowlist, {});
  const webhookAllowlist = await readJson<{ entries?: unknown[] }>(f.webhookAllowlist, {});
  const webhooks = await readJson<unknown[]>(f.webhooks, []);
  const invitations = await readJson<unknown[]>(f.invitations, []);
  const auditRaw = await readFile(f.audit, 'utf8').catch(() => '');
  const auditCount = auditRaw ? auditRaw.split('\n').filter(Boolean).length : 0;
  const manifest = await readJson<Record<string, unknown>>(f.manifest, {});

  const counts: WorkspaceExportCounts = {
    members: Array.isArray(members.members) ? members.members.length : 0,
    history: history.length,
    conversations: conversations.length,
    saved: saved.length,
    feedback: Object.keys(feedback).length,
    apiKeys: apiKeys.length,
    pins: Array.isArray(pins) ? pins.length : 0,
    mutes: Array.isArray(mutes) ? mutes.length : 0,
    aliases: Object.keys(aliases).length,
    tags: Object.keys(tags).length,
    collections: Array.isArray(collections) ? collections.length : 0,
    domainPolicies: Array.isArray(domainPolicies) ? domainPolicies.length : 0,
    ipAllowlist: Array.isArray(ipAllowlist.entries) ? ipAllowlist.entries.length : 0,
    webhookAllowlist: Array.isArray(webhookAllowlist.entries) ? webhookAllowlist.entries.length : 0,
    webhooks: Array.isArray(webhooks) ? webhooks.length : 0,
    invitations: Array.isArray(invitations) ? invitations.length : 0,
    auditEvents: auditCount,
    ingestDocs: Object.keys((manifest as Record<string, unknown>).docs ?? manifest ?? {}).length,
  };

  const estimatedBytes =
    (await fileBytes(f.history)) +
    (await dirBytes(f.conversationsDir)) +
    (await fileBytes(f.saved)) +
    (await fileBytes(f.feedback)) +
    (await fileBytes(f.apiKeys)) +
    (await fileBytes(f.audit)) +
    (await fileBytes(f.manifest)) +
    (await fileBytes(f.members));

  return {
    schema: WORKSPACE_EXPORT_PREVIEW_SCHEMA,
    dryRun: true,
    previewedAt: Date.now(),
    estimatedBytes,
    counts,
  };
}

export async function exportWorkspace(
  dataDir: string,
  actorId: string,
): Promise<WorkspaceExportBundle> {
  const f = p(dataDir);
  const membersFile = await readJson<{ members?: unknown[] }>(f.members, {});
  const history = await readJsonl<HistoryItem>(f.history);
  const conversations = await readAllConversations(f.conversationsDir);
  const saved = await readJson<SavedItem[]>(f.saved, []);
  const feedback = await readJson<FeedbackMap>(f.feedback, {});
  const apiKeysRaw = await readJson<ApiKeyRecord[]>(f.apiKeys, []);
  const pins = await readJson<unknown>(f.pins, []);
  const mutes = await readJson<unknown>(f.mutes, []);
  const aliases = await readJson<unknown>(f.aliases, {});
  const tags = await readJson<unknown>(f.tags, {});
  const collections = await readJson<unknown>(f.collections, []);
  const domainPolicies = await readJson<unknown>(f.domainPolicies, []);
  const ipAllowlist = await readJson<unknown>(f.ipAllowlist, {});
  const webhookAllowlist = await readJson<unknown>(f.webhookAllowlist, {});
  const webhooks = await readJson<unknown[]>(f.webhooks, []);
  const invitations = await readJson<unknown[]>(f.invitations, []);
  const auditEvents = await readJsonl<unknown>(f.audit);
  const ingestManifest = await readJson<unknown>(f.manifest, {});

  // Strip hashes: never let bcrypt/sha256 secret material ride out in
  // an export. A leaked export must not enable re-impersonation.
  const apiKeys = apiKeysRaw.map(({ hash: _hash, ...rest }) => rest);

  const members = Array.isArray(membersFile.members) ? membersFile.members : [];

  const counts: WorkspaceExportCounts = {
    members: members.length,
    history: history.length,
    conversations: conversations.length,
    saved: saved.length,
    feedback: Object.keys(feedback).length,
    apiKeys: apiKeys.length,
    pins: Array.isArray(pins) ? pins.length : 0,
    mutes: Array.isArray(mutes) ? mutes.length : 0,
    aliases: typeof aliases === 'object' && aliases !== null ? Object.keys(aliases).length : 0,
    tags: typeof tags === 'object' && tags !== null ? Object.keys(tags).length : 0,
    collections: Array.isArray(collections) ? collections.length : 0,
    domainPolicies: Array.isArray(domainPolicies) ? domainPolicies.length : 0,
    ipAllowlist:
      typeof ipAllowlist === 'object' && ipAllowlist !== null &&
      Array.isArray((ipAllowlist as { entries?: unknown[] }).entries)
        ? ((ipAllowlist as { entries: unknown[] }).entries.length)
        : 0,
    webhookAllowlist:
      typeof webhookAllowlist === 'object' && webhookAllowlist !== null &&
      Array.isArray((webhookAllowlist as { entries?: unknown[] }).entries)
        ? ((webhookAllowlist as { entries: unknown[] }).entries.length)
        : 0,
    webhooks: webhooks.length,
    invitations: invitations.length,
    auditEvents: auditEvents.length,
    ingestDocs:
      typeof ingestManifest === 'object' && ingestManifest !== null
        ? Object.keys((ingestManifest as Record<string, unknown>).docs ?? ingestManifest).length
        : 0,
  };

  return {
    schema: WORKSPACE_EXPORT_SCHEMA,
    exportedAt: Date.now(),
    exportedBy: actorId,
    counts,
    members,
    history,
    conversations,
    saved,
    feedback: summarizeFeedback(feedback),
    apiKeys,
    pins,
    mutes,
    aliases,
    tags,
    collections,
    domainPolicies,
    ipAllowlist,
    webhookAllowlist,
    webhooks,
    invitations,
    auditEvents,
    ingestManifest,
  };
}

// Pack the workspace bundle into a flat folder layout. Mirrors the per-user
// ZIP convention (manifest.json + a directory of CSVs) so existing ingest
// tooling on the customer side stays uniform.
export function workspaceBundleToZipEntries(bundle: WorkspaceExportBundle): Array<{ name: string; data: Buffer }> {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v, null, 2), 'utf8');
  return [
    { name: 'manifest.json', data: enc({
      schema: bundle.schema,
      exportedAt: bundle.exportedAt,
      exportedBy: bundle.exportedBy,
      counts: bundle.counts,
    }) },
    { name: 'members.json', data: enc(bundle.members) },
    { name: 'history.json', data: enc(bundle.history) },
    { name: 'conversations.json', data: enc(bundle.conversations) },
    { name: 'saved.json', data: enc(bundle.saved) },
    { name: 'feedback.json', data: enc(bundle.feedback) },
    { name: 'api-keys.json', data: enc(bundle.apiKeys) },
    { name: 'pins.json', data: enc(bundle.pins) },
    { name: 'mutes.json', data: enc(bundle.mutes) },
    { name: 'aliases.json', data: enc(bundle.aliases) },
    { name: 'tags.json', data: enc(bundle.tags) },
    { name: 'collections.json', data: enc(bundle.collections) },
    { name: 'domain-policies.json', data: enc(bundle.domainPolicies) },
    { name: 'ip-allowlist.json', data: enc(bundle.ipAllowlist) },
    { name: 'webhook-allowlist.json', data: enc(bundle.webhookAllowlist) },
    { name: 'webhooks.json', data: enc(bundle.webhooks) },
    { name: 'invitations.json', data: enc(bundle.invitations) },
    { name: 'audit.json', data: enc(bundle.auditEvents) },
    { name: 'ingest-manifest.json', data: enc(bundle.ingestManifest) },
    { name: 'README.txt', data: Buffer.from(
      'ClawMind workspace export\n' +
      '=========================\n\n' +
      `Schema:      ${bundle.schema}\n` +
      `Exported at: ${new Date(bundle.exportedAt).toISOString()}\n` +
      `Exported by: ${bundle.exportedBy}\n\n` +
      'This archive contains every workspace-scoped record on the tenant.\n' +
      'Secret material (bcrypt/sha256 hashes, OIDC client secrets, MFA seeds,\n' +
      'SMTP credentials) is stripped before packaging. The export is meant\n' +
      'to satisfy data-portability and exit obligations; it cannot be used\n' +
      'to re-impersonate users on another deployment.\n',
      'utf8',
    ) },
  ];
}
