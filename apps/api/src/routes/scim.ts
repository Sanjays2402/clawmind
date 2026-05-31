import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import {
  createScimUser,
  deleteScimUser,
  getScimUserById,
  getTokenView,
  listScimUsers,
  patchScimUser,
  revokeToken,
  rotateToken,
  scimErrorBody,
  serviceProviderConfig,
  verifyToken,
  type ScimError,
  type ScimPatchOp,
} from '../services/scim.js';
import { Scopes } from '../scopes.js';

// SCIM 2.0 user provisioning, plus the small in-app surface to mint and
// rotate the workspace SCIM token.
//
//   Token management (session, owner+MFA, audited):
//     GET  /v1/scim/token        view metadata (presence, lastUsedAt)
//     POST /v1/scim/token        rotate/issue a new token, plaintext shown once
//     DELETE /v1/scim/token      revoke the active token
//
//   SCIM 2.0 protocol surface (mounted at /scim/v2, bearer token only):
//     GET    /scim/v2/ServiceProviderConfig
//     GET    /scim/v2/ResourceTypes
//     GET    /scim/v2/Schemas
//     GET    /scim/v2/Users[?filter=&startIndex=&count=]
//     GET    /scim/v2/Users/:id
//     POST   /scim/v2/Users
//     PATCH  /scim/v2/Users/:id
//     DELETE /scim/v2/Users/:id

const RotateBody = z.object({}).optional();

// ---------- token-management routes (in-app) ----------

export const scimTokenRoutes: FastifyPluginAsync = async (app) => {
  app.get('/scim/token', {
    preHandler: [app.requireAuth, app.requireMinRole('owner'), app.requireScope(Scopes.MembersRead)],
    handler: async () => {
      const view = await getTokenView(app.clawmind.dataDir);
      return { token: view };
    },
  });

  app.post('/scim/token', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.MembersManage),
    ],
    handler: async (req, reply) => {
      const minted = await rotateToken(app.clawmind.dataDir, req.user!.id);
      await app.clawmind.audit.write({
        actor: req.user!.id,
        action: 'scim.token.rotate',
        resource: minted.id,
        meta: { ip: req.ip },
      });
      // Plaintext returned once.
      return reply.code(201).send({ id: minted.id, token: minted.token, createdAt: minted.createdAt });
    },
  });

  app.delete('/scim/token', {
    preHandler: [
      app.requireAuth,
      app.requireMinRole('owner'),
      app.requireMfa,
      app.requireScope(Scopes.MembersManage),
    ],
    handler: async (req) => {
      const r = await revokeToken(app.clawmind.dataDir);
      if (r.revoked) {
        await app.clawmind.audit.write({
          actor: req.user!.id,
          action: 'scim.token.revoke',
          resource: 'scim',
          meta: { ip: req.ip },
        });
      }
      return r;
    },
  });
};

// ---------- SCIM 2.0 protocol routes ----------

const SCIM_CT = 'application/scim+json';

function sendScim(reply: FastifyReply, status: number, body: unknown): FastifyReply {
  reply.header('content-type', SCIM_CT);
  return reply.code(status).send(body);
}

function statusFor(err: ScimError): number {
  switch (err.code) {
    case 'not-found':
      return 404;
    case 'bad-request':
      return 400;
    case 'conflict':
      return 409;
    case 'last-owner':
      return 409;
    case 'forbidden':
      return 403;
  }
}

function detailFor(err: ScimError): string {
  switch (err.code) {
    case 'not-found':
      return 'user not found';
    case 'bad-request':
      return err.detail;
    case 'conflict':
      return err.detail;
    case 'last-owner':
      return 'cannot deprovision the last remaining owner';
    case 'forbidden':
      return err.detail;
  }
}

function baseUrl(req: FastifyRequest): string {
  const proto = (req.headers['x-forwarded-proto'] as string) || 'http';
  const host = (req.headers['x-forwarded-host'] as string) || (req.headers.host as string) || 'localhost';
  return `${proto}://${host}/scim/v2`;
}

async function requireScimBearer(this: { dataDir: string }, req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return sendScim(reply, 401, scimErrorBody(401, 'bearer token required'));
  }
  const token = h.slice('Bearer '.length).trim();
  const id = await verifyToken(this.dataDir, token);
  if (!id) {
    return sendScim(reply, 401, scimErrorBody(401, 'invalid scim token'));
  }
  (req as unknown as { scimTokenId?: string }).scimTokenId = id;
}

export const scimProtocolRoutes: FastifyPluginAsync = async (app) => {
  const dataDir = app.clawmind.dataDir;
  const guard = requireScimBearer.bind({ dataDir });

  // Discovery endpoints. ServiceProviderConfig is allowed without a token
  // by SCIM 2.0 RFC so an IdP can probe support before exchanging secrets.
  app.get('/ServiceProviderConfig', async (req, reply) => {
    return sendScim(reply, 200, serviceProviderConfig(baseUrl(req)));
  });

  app.get('/ResourceTypes', async (_req, reply) => {
    return sendScim(reply, 200, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [
        {
          schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
          id: 'User',
          name: 'User',
          endpoint: '/Users',
          description: 'ClawMind workspace member',
          schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
          schemaExtensions: [
            {
              schema: 'urn:ietf:params:scim:schemas:extension:clawmind:2.0:User',
              required: false,
            },
          ],
        },
      ],
    });
  });

  app.get('/Schemas', async (_req, reply) => {
    return sendScim(reply, 200, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
      totalResults: 1,
      Resources: [
        {
          id: 'urn:ietf:params:scim:schemas:core:2.0:User',
          name: 'User',
          description: 'SCIM core User',
          attributes: [
            { name: 'userName', type: 'string', required: true, uniqueness: 'server' },
            { name: 'active', type: 'boolean', required: false },
            { name: 'displayName', type: 'string', required: false },
            { name: 'emails', type: 'complex', multiValued: true, required: false },
          ],
        },
      ],
    });
  });

  // All /Users routes require the SCIM bearer.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.includes('/Users')) return;
    await guard(req, reply);
  });

  app.get('/Users', async (req, reply) => {
    const q = req.query as { filter?: string; startIndex?: string; count?: string };
    const startIndex = q.startIndex ? parseInt(q.startIndex, 10) : 1;
    const count = q.count ? parseInt(q.count, 10) : 100;
    const list = await listScimUsers(dataDir, {
      filter: q.filter,
      startIndex: Number.isFinite(startIndex) ? startIndex : 1,
      count: Number.isFinite(count) ? count : 100,
      baseUrl: baseUrl(req),
    });
    return sendScim(reply, 200, list);
  });

  app.get<{ Params: { id: string } }>('/Users/:id', async (req, reply) => {
    const u = await getScimUserById(dataDir, req.params.id, baseUrl(req));
    if (!u) return sendScim(reply, 404, scimErrorBody(404, 'user not found'));
    return sendScim(reply, 200, u);
  });

  app.post('/Users', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const r = await createScimUser(dataDir, body as Parameters<typeof createScimUser>[1]);
    if (!r.ok) {
      const status = statusFor(r.err);
      const scimType = r.err.code === 'conflict' ? 'uniqueness' : undefined;
      await app.clawmind.audit.write({
        actor: `scim:${(req as unknown as { scimTokenId?: string }).scimTokenId ?? 'unknown'}`,
        action: 'scim.user.create.denied',
        resource: (body.userName as string) || (body.externalId as string) || 'unknown',
        meta: { code: r.err.code, ip: req.ip },
      });
      return sendScim(reply, status, scimErrorBody(status, detailFor(r.err), scimType));
    }
    await app.clawmind.audit.write({
      actor: `scim:${(req as unknown as { scimTokenId?: string }).scimTokenId ?? 'unknown'}`,
      action: 'scim.user.create',
      resource: r.user.id,
      meta: { userName: r.user.userName, role: r.user['urn:ietf:params:scim:schemas:extension:clawmind:2.0:User'].role, ip: req.ip },
    });
    return sendScim(reply, 201, r.user);
  });

  app.patch<{ Params: { id: string } }>('/Users/:id', async (req, reply) => {
    const body = (req.body ?? {}) as { Operations?: ScimPatchOp[] };
    const ops = Array.isArray(body.Operations) ? body.Operations : [];
    const r = await patchScimUser(dataDir, req.params.id, ops, 'scim:provisioner');
    if (!r.ok) {
      const status = statusFor(r.err);
      await app.clawmind.audit.write({
        actor: `scim:${(req as unknown as { scimTokenId?: string }).scimTokenId ?? 'unknown'}`,
        action: 'scim.user.patch.denied',
        resource: req.params.id,
        meta: { code: r.err.code, ip: req.ip },
      });
      return sendScim(reply, status, scimErrorBody(status, detailFor(r.err)));
    }
    if (r.changed) {
      await app.clawmind.audit.write({
        actor: `scim:${(req as unknown as { scimTokenId?: string }).scimTokenId ?? 'unknown'}`,
        action: 'scim.user.patch',
        resource: req.params.id,
        meta: { newRole: r.user['urn:ietf:params:scim:schemas:extension:clawmind:2.0:User'].role, ip: req.ip },
      });
    }
    return sendScim(reply, 200, r.user);
  });

  app.delete<{ Params: { id: string } }>('/Users/:id', async (req, reply) => {
    const r = await deleteScimUser(dataDir, req.params.id, 'scim:provisioner');
    if (!r.ok) {
      const status = statusFor(r.err);
      await app.clawmind.audit.write({
        actor: `scim:${(req as unknown as { scimTokenId?: string }).scimTokenId ?? 'unknown'}`,
        action: 'scim.user.delete.denied',
        resource: req.params.id,
        meta: { code: r.err.code, ip: req.ip },
      });
      return sendScim(reply, status, scimErrorBody(status, detailFor(r.err)));
    }
    await app.clawmind.audit.write({
      actor: `scim:${(req as unknown as { scimTokenId?: string }).scimTokenId ?? 'unknown'}`,
      action: 'scim.user.delete',
      resource: req.params.id,
      meta: { ip: req.ip },
    });
    return reply.code(204).send();
  });
};
