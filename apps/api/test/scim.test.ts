import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { AuditLog } from '@clawmind/store';

import { scimProtocolRoutes, scimTokenRoutes } from '../src/routes/scim.js';
import {
  applyFilter,
  createScimUser,
  deleteScimUser,
  patchScimUser,
  rotateToken,
  serviceProviderConfig,
  verifyToken,
} from '../src/services/scim.js';
import { inviteMember, listMembers } from '../src/services/members.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cm-scim-'));
  return () => rmSync(dir, { recursive: true, force: true });
});

describe('scim service basics', () => {
  it('mints a token whose plaintext verifies and a tampered string does not', async () => {
    const minted = await rotateToken(dir, 'o1');
    expect(minted.token.startsWith('scim_')).toBe(true);
    expect(await verifyToken(dir, minted.token)).toBe(minted.id);
    expect(await verifyToken(dir, minted.token + 'x')).toBe(null);
    expect(await verifyToken(dir, 'cm_notascimtoken')).toBe(null);
  });

  it('rotate replaces the previous token', async () => {
    const a = await rotateToken(dir, 'o1');
    const b = await rotateToken(dir, 'o1');
    expect(await verifyToken(dir, a.token)).toBe(null);
    expect(await verifyToken(dir, b.token)).toBe(b.id);
  });

  it('serviceProviderConfig advertises patch support', () => {
    const spc = serviceProviderConfig('https://example.com/scim/v2') as { patch: { supported: boolean } };
    expect(spc.patch.supported).toBe(true);
  });

  it('applyFilter handles userName eq', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', email: 'o1@example.com', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'm1', role: 'member', email: 'm1@example.com', invitedBy: 'o1' });
    const members = await listMembers(dir);
    expect(applyFilter(members, 'userName eq "o1@example.com"').map((m) => m.userId)).toEqual(['o1']);
    expect(applyFilter(members, 'userName eq "missing@example.com"')).toEqual([]);
  });
});

describe('scim user CRUD', () => {
  it('POST creates a member with role=member by default', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const r = await createScimUser(dir, {
      userName: 'newhire@example.com',
      emails: [{ value: 'newhire@example.com', primary: true }],
      displayName: 'New Hire',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.id).toBe('newhire@example.com');
      expect(r.user['urn:ietf:params:scim:schemas:extension:clawmind:2.0:User'].role).toBe('member');
    }
  });

  it('POST returns 409 on a second create with the same id', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const a = await createScimUser(dir, { userName: 'dup@example.com', emails: [{ value: 'dup@example.com', primary: true }] });
    const b = await createScimUser(dir, { userName: 'dup@example.com', emails: [{ value: 'dup@example.com', primary: true }] });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.err.code).toBe('conflict');
  });

  it('PATCH active=false demotes a member to viewer (soft suspend)', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'm1', role: 'member', invitedBy: 'o1' });
    const r = await patchScimUser(dir, 'm1', [{ op: 'replace', path: 'active', value: false }], 'o1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBe(true);
      expect(r.user['urn:ietf:params:scim:schemas:extension:clawmind:2.0:User'].role).toBe('viewer');
    }
  });

  it('PATCH refuses to deprovision the last owner', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const r = await patchScimUser(dir, 'o1', [{ op: 'replace', path: 'active', value: false }], 'o1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.err.code).toBe('last-owner');
  });

  it('DELETE refuses to remove the last owner', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    // Actor must differ from the target so we exercise the last-owner branch
    // rather than the self-remove guard.
    const r = await deleteScimUser(dir, 'o1', 'scim:provisioner');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.err.code).toBe('last-owner');
  });

  it('DELETE removes a regular member', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    await inviteMember(dir, { userId: 'm1', role: 'member', invitedBy: 'o1' });
    const r = await deleteScimUser(dir, 'm1', 'o1');
    expect(r.ok).toBe(true);
    expect((await listMembers(dir)).map((m) => m.userId)).toEqual(['o1']);
  });
});

describe('scim protocol routes', () => {
  function buildApp() {
    const app = Fastify();
    app.register(sensible);
    const audit = new AuditLog(join(dir, 'audit.log'));
    app.decorate('clawmind', { audit, dataDir: dir } as never);
    // SCIM clients send application/scim+json. Wire the same parser the
    // production server uses so inject() bodies are decoded.
    app.addContentTypeParser('application/scim+json', { parseAs: 'string' }, (_req, body, done) => {
      try {
        const t = (body as string).trim();
        done(null, t.length === 0 ? {} : JSON.parse(t));
      } catch (err) {
        done(err as Error, undefined);
      }
    });
    app.register(scimProtocolRoutes, { prefix: '/scim/v2' });
    return { app, audit };
  }

  it('rejects /Users with no bearer token', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'GET', url: '/scim/v2/Users' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('rejects /Users with a bad token', async () => {
    const { app } = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/scim/v2/Users',
      headers: { authorization: 'Bearer scim_not_a_real_one' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('lets /ServiceProviderConfig through unauthenticated', async () => {
    const { app } = buildApp();
    const res = await app.inject({ method: 'GET', url: '/scim/v2/ServiceProviderConfig' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.schemas).toContain('urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig');
    await app.close();
  });

  it('lists users after token issuance', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', email: 'o1@example.com', invitedBy: 'bootstrap' });
    const t = await rotateToken(dir, 'o1');
    const { app } = buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/scim/v2/Users',
      headers: { authorization: `Bearer ${t.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);
    expect(body.totalResults).toBe(1);
    expect(body.Resources[0].userName).toBe('o1@example.com');
    await app.close();
  });

  it('POST /Users creates and audits, PATCH active=false demotes', async () => {
    await inviteMember(dir, { userId: 'o1', role: 'owner', invitedBy: 'bootstrap' });
    const t = await rotateToken(dir, 'o1');
    const { app, audit } = buildApp();
    const create = await app.inject({
      method: 'POST',
      url: '/scim/v2/Users',
      headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/scim+json' },
      payload: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'svc@example.com',
        emails: [{ value: 'svc@example.com', primary: true }],
        displayName: 'Service Account',
        active: true,
      }),
    });
    expect(create.statusCode).toBe(201);

    const events = await audit.query({ action: 'scim.user.create' });
    expect(events.total).toBe(1);

    const patch = await app.inject({
      method: 'PATCH',
      url: '/scim/v2/Users/svc%40example.com',
      headers: { authorization: `Bearer ${t.token}`, 'content-type': 'application/scim+json' },
      payload: JSON.stringify({
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: false }],
      }),
    });
    expect(patch.statusCode).toBe(200);
    const body = JSON.parse(patch.payload);
    expect(body['urn:ietf:params:scim:schemas:extension:clawmind:2.0:User'].role).toBe('viewer');
    await app.close();
  });
});
