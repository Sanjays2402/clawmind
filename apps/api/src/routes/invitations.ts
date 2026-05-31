import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  acceptInvitation,
  peekByToken,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
  toView,
} from '../services/invitations.js';
import { MEMBER_ROLES, type MemberRole } from '../services/members.js';
import { Scopes } from '../scopes.js';

// Email-token workspace invitations.
//
//   GET    /v1/invitations              list (admin+, invitations:read)
//   POST   /v1/invitations              mint email-bound invite (owner+admin, invitations:admin, MFA)
//   DELETE /v1/invitations/:id          revoke pending invite (owner+admin, invitations:admin, MFA)
//   GET    /v1/invitations/peek         look up token metadata (auth, no scope)
//   POST   /v1/invitations/accept       redeem single-use token (auth, no scope)
//
// Mutations are MFA-stepped and audit-logged with a before/after diff so an
// external reviewer can trace which operator invited or revoked which
// email. The raw token is returned exactly once from POST so an operator
// can hand it to the email transport; the on-disk registry only keeps the
// sha256 digest.

const RoleEnum = z.enum(MEMBER_ROLES as readonly [MemberRole, ...MemberRole[]]);

const CreateSchema = z.object({
  email: z.string().trim().email().max(320),
  role: RoleEnum,
  label: z.string().trim().min(1).max(200).nullish(),
  ttlMs: z.number().int().positive().max(MAX_TTL_MS).optional(),
  dryRun: z.boolean().optional(),
});

const PeekQuery = z.object({ token: z.string().min(16).max(512) });
const AcceptBody = z.object({ token: z.string().min(16).max(512) });
const DeleteQuery = z.object({ dry_run: z.enum(['true', 'false']).optional() });

function actorRole(role: string): MemberRole {
  if (role === 'reader') return 'viewer';
  if (role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer') return role;
  return 'viewer';
}

export const invitationRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get('/invitations', {
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.InvitationsRead)],
    handler: async () => {
      const invitations = await listInvitations(app.clawmind.dataDir);
      return { invitations, defaultTtlMs: DEFAULT_TTL_MS, maxTtlMs: MAX_TTL_MS };
    },
  });

  app.post('/invitations', {
    schema: { body: CreateSchema },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireMfa,
      app.requireScope(Scopes.InvitationsManage),
    ],
    handler: async (req, reply) => {
      const me = req.user!;
      const aRole = actorRole(me.role);
      if (req.body.role === 'owner' && aRole !== 'owner') {
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'invitations.create.denied',
          resource: req.body.email.toLowerCase(),
          meta: { code: 'forbidden-role', requestedRole: req.body.role, ip: req.ip },
        });
        return reply.code(403).send({ error: 'forbidden', message: 'only owners can invite owners' });
      }
      if (req.body.dryRun) {
        return {
          dryRun: true,
          wouldInvite: { email: req.body.email.toLowerCase(), role: req.body.role, ttlMs: req.body.ttlMs ?? DEFAULT_TTL_MS },
        };
      }
      const result = await createInvitation(app.clawmind.dataDir, {
        email: req.body.email,
        role: req.body.role,
        invitedBy: me.id,
        invitedByRole: aRole,
        label: req.body.label ?? null,
        ttlMs: req.body.ttlMs,
      });
      if (!result.ok) {
        const status = result.code === 'invalid-email' ? 400 : result.code === 'duplicate' ? 409 : 403;
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'invitations.create.denied',
          resource: req.body.email.toLowerCase(),
          meta: { code: result.code, requestedRole: req.body.role, ip: req.ip },
        });
        return reply.code(status).send({ error: result.code, message: (result as { message?: string }).message });
      }
      const view = toView(result.record);
      await app.clawmind.audit.write({
        actor: me.id,
        action: 'invitations.create',
        resource: view.id,
        meta: {
          before: null,
          after: { email: view.email, role: view.role, expiresAt: view.expiresAt, label: view.label },
          ip: req.ip,
        },
      });
      reply.code(201);
      // Raw token is returned exactly once. Hand off to the email transport.
      // acceptUrl is rendered relative; the web app prefixes the public origin.
      const acceptUrl = `/invitations/accept?token=${encodeURIComponent(result.token)}`;
      return { invitation: view, token: result.token, acceptUrl };
    },
  });

  app.delete<{ Params: { id: string }; Querystring: { dry_run?: string } }>('/invitations/:id', {
    schema: {
      params: z.object({ id: z.string().min(1).max(80) }),
      querystring: DeleteQuery,
    },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireMfa,
      app.requireScope(Scopes.InvitationsManage),
    ],
    handler: async (req, reply) => {
      const me = req.user!;
      if (req.query.dry_run === 'true') {
        return { dryRun: true, wouldRevoke: req.params.id };
      }
      const result = await revokeInvitation(app.clawmind.dataDir, req.params.id, {
        userId: me.id,
        role: actorRole(me.role),
      });
      if (!result.ok) {
        const status = result.code === 'not-found' ? 404 : 409;
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'invitations.revoke.denied',
          resource: req.params.id,
          meta: { code: result.code, ip: req.ip },
        });
        return reply.code(status).send({ error: result.code });
      }
      await app.clawmind.audit.write({
        actor: me.id,
        action: 'invitations.revoke',
        resource: result.record.id,
        meta: {
          before: { status: 'pending', email: result.record.email, role: result.record.role },
          after: { status: 'revoked' },
          ip: req.ip,
        },
      });
      return { invitation: result.record };
    },
  });

  app.get('/invitations/peek', {
    schema: { querystring: PeekQuery },
    preHandler: [app.requireAuth],
    handler: async (req, reply) => {
      const peek = await peekByToken(app.clawmind.dataDir, req.query.token);
      if (!peek) return reply.code(404).send({ error: 'not-found' });
      return { invitation: peek };
    },
  });

  app.post('/invitations/accept', {
    schema: { body: AcceptBody },
    preHandler: [app.requireAuth],
    handler: async (req, reply) => {
      const me = req.user!;
      const result = await acceptInvitation(app.clawmind.dataDir, {
        token: req.body.token,
        userId: me.id,
        userEmail: me.email ?? null,
      });
      if (!result.ok) {
        const status =
          result.code === 'not-found' ? 404 :
          result.code === 'expired' || result.code === 'revoked' || result.code === 'consumed' ? 409 :
          result.code === 'email-mismatch' ? 403 : 400;
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'invitations.accept.denied',
          resource: me.id,
          meta: { code: result.code, ip: req.ip },
        });
        return reply.code(status).send({ error: result.code });
      }
      await app.clawmind.audit.write({
        actor: me.id,
        action: 'invitations.accept',
        resource: result.record.id,
        meta: {
          before: { status: 'pending', email: result.record.email },
          after: { status: 'accepted', userId: me.id, role: result.assignedRole },
          ip: req.ip,
        },
      });
      return { invitation: result.record, assignedRole: result.assignedRole };
    },
  });
};
