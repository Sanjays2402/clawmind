import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import {
  MEMBER_ROLES,
  filterMembers,
  inviteMember,
  listMembers,
  removeMember,
  updateRole,
  type MemberRole,
} from '../services/members.js';
import { Scopes } from '../scopes.js';
import { sweepUser } from '../services/offboarding.js';

// Workspace member management. Backs the 4-role RBAC model in
// services/members.ts. Every mutation is MFA-stepped and audit-logged
// with a before/after diff so an external SOC2 reviewer can trace who
// granted what permission to whom.
//
//   GET    /v1/members                  list (admin+, members:read)
//   POST   /v1/members                  invite by userId (owner+admin, members:admin, MFA)
//   PATCH  /v1/members/:userId          change role (owner+admin, members:admin, MFA)
//   DELETE /v1/members/:userId          remove (owner+admin, members:admin, MFA)

const RoleEnum = z.enum(MEMBER_ROLES as readonly [MemberRole, ...MemberRole[]]);

const InviteSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  role: RoleEnum,
  email: z.string().trim().email().max(320).nullish(),
  label: z.string().trim().min(1).max(200).nullish(),
  dryRun: z.boolean().optional(),
});

const PatchSchema = z.object({
  role: RoleEnum,
  dryRun: z.boolean().optional(),
});

const DeleteQuerySchema = z.object({
  dry_run: z.enum(['true', 'false']).optional(),
});

function actorRole(role: string): MemberRole {
  if (role === 'reader') return 'viewer';
  if (role === 'owner' || role === 'admin' || role === 'member' || role === 'viewer') return role;
  return 'viewer';
}

export const memberRoutes: FastifyPluginAsyncZod = async (app) => {
  // Optional `q` filters by a case-insensitive substring of the member's
  // userId, email, or label. Mirrors the same filter on /keys, /mutes,
  // /pins, and /query-blocklist so an admin staring at a long Members
  // page can search by what they remember (a partial email, a userId
  // prefix copied from an audit row, or a free-form label).
  app.get<{ Querystring: { q?: string } }>('/members', {
    schema: {
      querystring: z.object({
        q: z.string().trim().min(1).max(200).optional(),
      }),
    },
    preHandler: [app.requireAuth, app.requireMinRole('admin'), app.requireScope(Scopes.MembersRead)],
    handler: async (req) => {
      const all = await listMembers(app.clawmind.dataDir);
      const members = filterMembers(all, req.query.q);
      return { members };
    },
  });

  app.post('/members', {
    schema: { body: InviteSchema },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireMfa,
      app.requireScope(Scopes.MembersManage),
    ],
    handler: async (req, reply) => {
      const me = req.user!;
      const actor = { userId: me.id, role: actorRole(me.role) };
      // Admins cannot mint owners. Owners can mint anyone.
      if (req.body.role === 'owner' && actor.role !== 'owner') {
        return reply.code(403).send({ error: 'forbidden', message: 'only owners can invite owners' });
      }
      if (req.body.dryRun) {
        return { dryRun: true, wouldInvite: { userId: req.body.userId, role: req.body.role } };
      }
      const result = await inviteMember(app.clawmind.dataDir, {
        userId: req.body.userId,
        role: req.body.role,
        email: req.body.email ?? null,
        label: req.body.label ?? null,
        invitedBy: me.id,
      });
      await app.clawmind.audit.write({
        actor: me.id,
        action: result.created ? 'members.invite' : 'members.invite.noop',
        resource: req.body.userId,
        meta: { role: req.body.role, ip: req.ip, created: result.created },
      });
      reply.code(result.created ? 201 : 200);
      return { created: result.created, member: result.record };
    },
  });

  app.patch<{ Params: { userId: string }; Body: z.infer<typeof PatchSchema> }>('/members/:userId', {
    schema: {
      body: PatchSchema,
      params: z.object({ userId: z.string().min(1).max(200) }),
    },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireMfa,
      app.requireScope(Scopes.MembersManage),
    ],
    handler: async (req, reply) => {
      const me = req.user!;
      const actor = { userId: me.id, role: actorRole(me.role) };
      if (req.body.dryRun) {
        return { dryRun: true, wouldSet: { userId: req.params.userId, role: req.body.role } };
      }
      const result = await updateRole(app.clawmind.dataDir, req.params.userId, req.body.role, actor);
      if (!result.ok) {
        const status = result.code === 'not-found' ? 404 : 409;
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'members.role.denied',
          resource: req.params.userId,
          meta: { code: result.code, requestedRole: req.body.role, ip: req.ip },
        });
        return reply.code(status).send({ error: result.code, message: (result as { message?: string }).message });
      }
      await app.clawmind.audit.write({
        actor: me.id,
        action: 'members.role.update',
        resource: req.params.userId,
        meta: {
          before: { role: result.before.role },
          after: { role: result.after.role },
          ip: req.ip,
        },
      });
      return { member: result.after };
    },
  });

  app.delete<{ Params: { userId: string }; Querystring: { dry_run?: string } }>('/members/:userId', {
    schema: {
      params: z.object({ userId: z.string().min(1).max(200) }),
      querystring: DeleteQuerySchema,
    },
    preHandler: [
      app.requireAuth,
      app.requireMinRole('admin'),
      app.requireMfa,
      app.requireScope(Scopes.MembersManage),
    ],
    handler: async (req, reply) => {
      const me = req.user!;
      const actor = { userId: me.id, role: actorRole(me.role) };
      if (req.query.dry_run === 'true') {
        return { dryRun: true, wouldRemove: req.params.userId };
      }
      const result = await removeMember(app.clawmind.dataDir, req.params.userId, actor);
      if (!result.ok) {
        const status = result.code === 'not-found' ? 404 : 409;
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'members.remove.denied',
          resource: req.params.userId,
          meta: { code: result.code, ip: req.ip },
        });
        return reply.code(status).send({ error: result.code, message: (result as { message?: string }).message });
      }
      // Offboarding sweep: any API key or session that survived this user
      // would be a dangling credential. Revoke them in the same operation
      // and surface counts in the audit row so an external reviewer can
      // verify the cleanup happened atomically with the membership change.
      const swept = await sweepUser(app.clawmind.dataDir, req.params.userId);
      await app.clawmind.audit.write({
        actor: me.id,
        action: 'members.remove',
        resource: req.params.userId,
        meta: {
          before: { role: result.removed.role },
          ip: req.ip,
          keysRevoked: swept.keysRevoked,
          sessionsRevoked: swept.sessionsRevoked,
        },
      });
      if (swept.keysRevoked > 0 || swept.sessionsRevoked > 0) {
        await app.clawmind.audit.write({
          actor: me.id,
          action: 'members.offboarding.sweep',
          resource: req.params.userId,
          meta: {
            ip: req.ip,
            keyIds: swept.keyIds,
            keysRevoked: swept.keysRevoked,
            sessionsRevoked: swept.sessionsRevoked,
          },
        });
      }
      return { removed: result.removed, offboarding: swept };
    },
  });
};
