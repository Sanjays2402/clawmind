import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  getRegister,
  createBreach,
  updateBreach,
  deleteBreach,
  publicList,
  publicView,
  filterRegister,
  toCsv,
  validateCreate,
  BreachValidationError,
  ART33_WINDOW_MS,
} from '../src/services/breach-register.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-breach-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0); // 2026-01-01 00:00:00 UTC

const baseInput = () => ({
  reference: 'BR-2026-001',
  title: 'Misconfigured object storage exposed support attachments',
  summary: 'A public-read ACL on the support-attachments bucket exposed redacted ticket files.',
  severity: 'high' as const,
  status: 'contained' as const,
  discoveredAt: T0,
  occurredAt: T0 - 3600_000,
  containedAt: T0 + 1800_000,
  closedAt: null,
  dataCategories: 'support ticket attachments, contact details',
  dataSubjects: 'customer admins, end-users referenced in tickets',
  approxRecords: 1234,
  approxSubjects: 412,
  likelyConsequences: 'limited reputational risk; no credentials exposed',
  mitigations: 'revoked ACL, rotated bucket, forced re-auth of affected support agents',
  authorityNotification: 'notified' as const,
  authorityName: 'IE DPC (lead supervisory authority)',
  authorityNotifiedAt: T0 + ART33_WINDOW_MS - 3600_000, // within 72h
  delayJustification: null,
  subjectNotification: 'notified' as const,
  subjectNotifiedAt: T0 + 24 * 3600_000,
  contact: 'dpo@example.com',
  internalNotes: 'ticket ZD-9182',
});

describe('breach register validation', () => {
  it('rejects missing required fields', () => {
    expect(() => validateCreate({ ...baseInput(), title: '' } as any)).toThrow(BreachValidationError);
    expect(() => validateCreate({ ...baseInput(), summary: '' } as any)).toThrow(BreachValidationError);
    expect(() => validateCreate({ ...baseInput(), mitigations: '' } as any)).toThrow(BreachValidationError);
    expect(() => validateCreate({ ...baseInput(), dataCategories: '' } as any)).toThrow(BreachValidationError);
  });

  it('rejects unknown enums', () => {
    expect(() => validateCreate({ ...baseInput(), severity: 'mild' as any })).toThrow(BreachValidationError);
    expect(() => validateCreate({ ...baseInput(), authorityNotification: 'soon' as any })).toThrow(BreachValidationError);
  });

  it('requires authorityNotifiedAt when notification status is notified or delayed', () => {
    expect(() =>
      validateCreate({ ...baseInput(), authorityNotification: 'notified', authorityNotifiedAt: null }),
    ).toThrow(/authorityNotifiedAt is required/);
  });

  it('requires a delayJustification when authority notification is later than 72h after discovery', () => {
    expect(() =>
      validateCreate({
        ...baseInput(),
        authorityNotification: 'notified',
        authorityNotifiedAt: T0 + ART33_WINDOW_MS + 3600_000,
        delayJustification: null,
      }),
    ).toThrow(/72 hours/);
  });

  it('requires a delayJustification when authorityNotification is explicitly delayed', () => {
    expect(() =>
      validateCreate({
        ...baseInput(),
        authorityNotification: 'delayed',
        authorityNotifiedAt: T0 + 3600_000,
        delayJustification: null,
      }),
    ).toThrow(/delayJustification is required/);
  });

  it('requires closedAt when status is closed', () => {
    expect(() =>
      validateCreate({ ...baseInput(), status: 'closed', closedAt: null }),
    ).toThrow(/closedAt is required/);
  });

  it('rejects containedAt earlier than discoveredAt', () => {
    expect(() =>
      validateCreate({ ...baseInput(), containedAt: T0 - 1000 }),
    ).toThrow(/cannot precede discoveredAt/);
  });

  it('accepts a complete on-time notification', () => {
    const v = validateCreate(baseInput());
    expect(v.reference).toBe('BR-2026-001');
    expect(v.authorityNotification).toBe('notified');
    expect(v.contact).toBe('dpo@example.com');
  });
});

describe('breach register CRUD and projections', () => {
  it('starts empty and persists across reads', async () => {
    const reg = await getRegister(dir);
    expect(reg.entries).toEqual([]);
    const e = await createBreach(dir, 'owner_1', baseInput(), T0);
    expect(e.id).toBeTruthy();
    const reload = await getRegister(dir);
    expect(reload.entries.length).toBe(1);
    expect(reload.entries[0]!.reference).toBe('BR-2026-001');
    expect(reload.updatedBy).toBe('owner_1');
  });

  it('rejects duplicate references on create and update', async () => {
    await createBreach(dir, 'owner_1', baseInput(), T0);
    await expect(createBreach(dir, 'owner_1', baseInput(), T0)).rejects.toThrow(/already exists/);
    const second = await createBreach(
      dir,
      'owner_1',
      { ...baseInput(), reference: 'BR-2026-002' },
      T0 + 1000,
    );
    await expect(
      updateBreach(dir, 'owner_1', second.id, { ...baseInput(), reference: 'BR-2026-001' }, T0 + 2000),
    ).rejects.toThrow(/already exists/);
  });

  it('updateBreach preserves createdAt and refreshes updatedAt + updatedBy', async () => {
    const created = await createBreach(dir, 'owner_1', baseInput(), T0);
    const updated = await updateBreach(
      dir,
      'owner_2',
      created.id,
      { ...baseInput(), status: 'closed', closedAt: T0 + 5 * 24 * 3600_000 },
      T0 + 5 * 24 * 3600_000,
    );
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).toBeGreaterThan(created.updatedAt);
    expect(updated.updatedBy).toBe('owner_2');
    expect(updated.status).toBe('closed');
  });

  it('deleteBreach returns false for unknown ids and true for known ids', async () => {
    expect(await deleteBreach(dir, 'owner_1', 'nope', T0)).toBe(false);
    const e = await createBreach(dir, 'owner_1', baseInput(), T0);
    expect(await deleteBreach(dir, 'owner_1', e.id, T0 + 1)).toBe(true);
    expect((await getRegister(dir)).entries.length).toBe(0);
  });

  it('publicView strips internalNotes and updatedBy and derives Art. 33 window flag', async () => {
    const e = await createBreach(dir, 'owner_1', baseInput(), T0);
    const view = publicView(e);
    expect((view as any).internalNotes).toBeUndefined();
    expect((view as any).updatedBy).toBeUndefined();
    expect(view.withinArt33Window).toBe(true);
  });

  it('publicList returns counters and reverse-chronological ordering', async () => {
    await createBreach(dir, 'owner_1', baseInput(), T0);
    await createBreach(
      dir,
      'owner_1',
      {
        ...baseInput(),
        reference: 'BR-2026-002',
        discoveredAt: T0 + 7 * 24 * 3600_000,
        occurredAt: T0 + 7 * 24 * 3600_000 - 3600_000,
        containedAt: T0 + 7 * 24 * 3600_000 + 1800_000,
        authorityNotification: 'notified',
        authorityNotifiedAt: T0 + 7 * 24 * 3600_000 + ART33_WINDOW_MS + 7200_000,
        subjectNotifiedAt: T0 + 8 * 24 * 3600_000,
        delayJustification: 'authority contact channel was offline during disclosure window',
      },
      T0 + 7 * 24 * 3600_000,
    );
    const reg = await getRegister(dir);
    const list = publicList(reg);
    expect(list.totalCount).toBe(2);
    expect(list.openCount).toBe(2); // both contained (not closed)
    expect(list.overdueCount).toBe(1);
    expect(list.entries[0]!.reference).toBe('BR-2026-002');
    expect(list.entries[1]!.reference).toBe('BR-2026-001');
  });

  it('toCsv emits a header row plus one row per entry with quoted commas', async () => {
    await createBreach(
      dir,
      'owner_1',
      { ...baseInput(), dataCategories: 'one, two, three' },
      T0,
    );
    const reg = await getRegister(dir);
    const csv = toCsv(reg);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('reference,title,summary,severity');
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain('"one, two, three"');
  });

  it('filterRegister returns the register unchanged when q is empty or whitespace', async () => {
    await createBreach(dir, 'owner_1', baseInput(), T0);
    const reg = await getRegister(dir);
    expect(filterRegister(reg, undefined).entries.length).toBe(1);
    expect(filterRegister(reg, '   ').entries.length).toBe(1);
    expect(filterRegister(reg, '').entries.length).toBe(1);
  });

  it('filterRegister matches a case-insensitive substring across reference, title, summary, dataCategories, and dataSubjects', async () => {
    await createBreach(dir, 'owner_1', baseInput(), T0); // BR-2026-001, support bucket
    await createBreach(
      dir,
      'owner_1',
      {
        ...baseInput(),
        reference: 'BR-2026-002',
        title: 'Vendor backup snapshot retained past contract end',
        summary: 'Offsite backup vendor kept a snapshot 11 days past the agreed deletion date.',
        dataCategories: 'workspace exports',
        dataSubjects: 'workspace owners',
        discoveredAt: T0 + 24 * 3600_000,
        occurredAt: T0 + 24 * 3600_000 - 3600_000,
        containedAt: T0 + 24 * 3600_000 + 1800_000,
        authorityNotifiedAt: T0 + 24 * 3600_000 + 3600_000,
        subjectNotifiedAt: T0 + 25 * 3600_000,
      },
      T0 + 24 * 3600_000,
    );
    const reg = await getRegister(dir);

    // by reference
    expect(filterRegister(reg, 'BR-2026-002').entries.map((e) => e.reference)).toEqual(['BR-2026-002']);
    // by title, case-insensitive
    expect(filterRegister(reg, 'BACKUP').entries.map((e) => e.reference)).toEqual(['BR-2026-002']);
    // by summary substring
    expect(filterRegister(reg, 'bucket').entries.map((e) => e.reference)).toEqual(['BR-2026-001']);
    // by dataSubjects
    expect(filterRegister(reg, 'workspace owners').entries.map((e) => e.reference)).toEqual(['BR-2026-002']);
    // no match
    expect(filterRegister(reg, 'nothing-here').entries.length).toBe(0);
    // shared substring matches both
    expect(filterRegister(reg, 'br-2026').entries.length).toBe(2);
  });

  it('filterRegister preserves updatedAt and updatedBy so counters reflect the filtered slice only', async () => {
    await createBreach(dir, 'owner_1', baseInput(), T0);
    const reg = await getRegister(dir);
    const filtered = filterRegister(reg, 'nothing-here');
    expect(filtered.entries.length).toBe(0);
    expect(filtered.updatedAt).toBe(reg.updatedAt);
    expect(filtered.updatedBy).toBe(reg.updatedBy);
    // publicList over the filtered slice reports the filtered counts
    const list = publicList(filtered);
    expect(list.totalCount).toBe(0);
    expect(list.openCount).toBe(0);
    expect(list.overdueCount).toBe(0);
  });
});
