import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  listIncidents,
  createIncident,
  updateIncident,
  deleteIncident,
  getIncident,
  publicView,
  publicList,
  filterIncidents,
  validateInput,
  IncidentValidationError,
} from '../src/services/incidents.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-incidents-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('incident validation', () => {
  it('rejects unknown severity', () => {
    expect(() =>
      validateInput({
        title: 'Outage',
        severity: 'apocalyptic' as never,
        status: 'investigating',
        startedAt: Date.now(),
      }),
    ).toThrow(IncidentValidationError);
  });

  it('rejects unknown status', () => {
    expect(() =>
      validateInput({
        title: 'Outage',
        severity: 'high',
        status: 'on_fire' as never,
        startedAt: Date.now(),
      }),
    ).toThrow(IncidentValidationError);
  });

  it('requires resolvedAt when status is resolved', () => {
    expect(() =>
      validateInput({
        title: 'Brief outage',
        severity: 'low',
        status: 'resolved',
        startedAt: Date.now(),
      }),
    ).toThrow(IncidentValidationError);
  });

  it('forbids resolvedAt unless status is resolved', () => {
    expect(() =>
      validateInput({
        title: 'Ongoing',
        severity: 'medium',
        status: 'monitoring',
        startedAt: 1000,
        resolvedAt: 2000,
      }),
    ).toThrow(IncidentValidationError);
  });

  it('rejects resolvedAt earlier than startedAt', () => {
    expect(() =>
      validateInput({
        title: 'Bad clock',
        severity: 'low',
        status: 'resolved',
        startedAt: 5000,
        resolvedAt: 1000,
      }),
    ).toThrow(IncidentValidationError);
  });

  it('rejects oversized title', () => {
    expect(() =>
      validateInput({
        title: 'x'.repeat(500),
        severity: 'low',
        status: 'investigating',
        startedAt: Date.now(),
      }),
    ).toThrow(IncidentValidationError);
  });
});

describe('incident storage', () => {
  it('starts empty on a fresh install', async () => {
    expect(await listIncidents(dir)).toEqual([]);
  });

  it('creates, persists, lists newest first, and stamps updatedBy', async () => {
    const a = await createIncident(dir, 'user_owner', {
      title: 'Old incident',
      severity: 'low',
      status: 'resolved',
      startedAt: 1000,
      resolvedAt: 2000,
      summary: 'Brief blip.',
    });
    const b = await createIncident(dir, 'user_owner', {
      title: 'Recent incident',
      severity: 'high',
      status: 'monitoring',
      startedAt: 9000,
    });
    expect(a.id).toMatch(/^inc_/);
    expect(b.updatedBy).toBe('user_owner');

    const list = await listIncidents(dir);
    expect(list.map((i) => i.title)).toEqual(['Recent incident', 'Old incident']);
  });

  it('updates an existing incident', async () => {
    const inc = await createIncident(dir, 'user_owner', {
      title: 'Latency spike',
      severity: 'medium',
      status: 'investigating',
      startedAt: 1000,
    });
    const next = await updateIncident(dir, 'user_owner', inc.id, {
      title: 'Latency spike',
      severity: 'medium',
      status: 'resolved',
      startedAt: 1000,
      resolvedAt: 3000,
      updates: [{ message: 'Rolled back deploy.', status: 'resolved' }],
    });
    expect(next.status).toBe('resolved');
    expect(next.resolvedAt).toBe(3000);
    expect(next.updates).toHaveLength(1);
    expect(next.updates[0]!.at).toBeGreaterThan(0);
  });

  it('returns false when deleting a missing id', async () => {
    expect(await deleteIncident(dir, 'inc_missing')).toBe(false);
  });

  it('deletes an incident', async () => {
    const inc = await createIncident(dir, 'user_owner', {
      title: 'Test',
      severity: 'low',
      status: 'investigating',
      startedAt: 1000,
    });
    expect(await deleteIncident(dir, inc.id)).toBe(true);
    expect(await getIncident(dir, inc.id)).toBeNull();
  });

  it('throws not-found when updating an unknown id', async () => {
    await expect(
      updateIncident(dir, 'u', 'inc_missing', {
        title: 'x',
        severity: 'low',
        status: 'investigating',
        startedAt: 1000,
      }),
    ).rejects.toThrow(IncidentValidationError);
  });
});

describe('public projection', () => {
  it('strips operator-only fields from publicView', async () => {
    const inc = await createIncident(dir, 'user_owner', {
      title: 'API 5xx burst',
      severity: 'high',
      status: 'monitoring',
      startedAt: 1000,
      privateNotes: 'Internal: bad index on conversations table.',
      affectedComponents: ['api'],
      customerDataImpacted: false,
    });
    const view = publicView(inc) as Record<string, unknown>;
    expect(view).not.toHaveProperty('privateNotes');
    expect(view).not.toHaveProperty('updatedBy');
    expect(view).not.toHaveProperty('createdAt');
    expect(view.title).toBe('API 5xx burst');
    expect(view.affectedComponents).toEqual(['api']);
  });

  it('orders update timeline newest-first in publicView', () => {
    const view = publicView({
      id: 'inc_x',
      title: 't',
      summary: '',
      severity: 'low',
      status: 'monitoring',
      startedAt: 1000,
      resolvedAt: null,
      affectedComponents: [],
      customerDataImpacted: false,
      updates: [
        { at: 1000, message: 'a', status: 'investigating' },
        { at: 3000, message: 'c', status: 'monitoring' },
        { at: 2000, message: 'b', status: 'identified' },
      ],
      privateNotes: '',
      createdAt: 1000,
      updatedAt: 1000,
      updatedBy: 'u',
    });
    const updates = (view.updates as Array<{ message: string }>).map((u) => u.message);
    expect(updates).toEqual(['c', 'b', 'a']);
  });

  it('publicList wraps incidents and stamps generatedAt', () => {
    const out = publicList([]) as Record<string, unknown>;
    expect(out.incidents).toEqual([]);
    expect(typeof out.generatedAt).toBe('number');
  });
});

describe('filterIncidents', () => {
  const base = {
    summary: '',
    resolvedAt: null,
    customerDataImpacted: false,
    updates: [],
    privateNotes: '',
    createdAt: 1000,
    updatedAt: 1000,
    updatedBy: 'u',
  } as const;
  const incidents = [
    {
      id: 'inc_a',
      title: 'API 5xx burst',
      severity: 'high' as const,
      status: 'monitoring' as const,
      startedAt: 1000,
      affectedComponents: ['api', 'rag'],
      ...base,
      summary: 'Elevated 5xx rate on /v1/ask.',
    },
    {
      id: 'inc_b',
      title: 'Web UI blank page',
      severity: 'medium' as const,
      status: 'resolved' as const,
      startedAt: 2000,
      resolvedAt: 3000,
      affectedComponents: ['web'],
      ...base,
      summary: 'Bad build pushed to web app.',
    },
    {
      id: 'inc_c',
      title: 'Embed worker stall',
      severity: 'low' as const,
      status: 'resolved' as const,
      startedAt: 4000,
      resolvedAt: 5000,
      affectedComponents: ['ingest'],
      ...base,
      summary: '',
    },
  ];

  it('returns the input when q is empty or whitespace', () => {
    expect(filterIncidents(incidents, undefined)).toBe(incidents);
    expect(filterIncidents(incidents, '')).toBe(incidents);
    expect(filterIncidents(incidents, '   ')).toBe(incidents);
  });

  it('matches a substring of the title case-insensitively', () => {
    const out = filterIncidents(incidents, 'web ui');
    expect(out.map((i) => i.id)).toEqual(['inc_b']);
  });

  it('matches a substring of the summary', () => {
    const out = filterIncidents(incidents, 'v1/ask');
    expect(out.map((i) => i.id)).toEqual(['inc_a']);
  });

  it('matches a substring of any affectedComponents entry', () => {
    const out = filterIncidents(incidents, 'ingest');
    expect(out.map((i) => i.id)).toEqual(['inc_c']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterIncidents(incidents, 'nope-zzz')).toEqual([]);
  });
});
