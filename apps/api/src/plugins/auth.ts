import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; github: string | null; role: 'owner' | 'reader' };
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  const env = app.clawmind.env;

  app.addHook('preHandler', async (req) => {
    if (env.CLAWMIND_AUTH_MODE === 'single-user') {
      req.user = { id: 'local', github: null, role: 'owner' };
      return;
    }
    if (req.session.userId) {
      req.user = {
        id: req.session.userId,
        github: req.session.github ?? null,
        role: 'owner',
      };
    }
  });

  app.decorate('requireAuth', async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
    if (!req.user) {
      reply.code(401).send({ error: 'auth required' });
    }
  });

  app.decorate('requireRole', function requireRole(role: 'owner' | 'reader') {
    return async function (req: FastifyRequest, reply: FastifyReply) {
      if (!req.user) return reply.code(401).send({ error: 'auth required' });
      if (role === 'owner' && req.user.role !== 'owner') {
        return reply.code(403).send({ error: 'forbidden' });
      }
    };
  });

  // OAuth start
  app.get('/auth/github', async (_req, reply) => {
    if (env.CLAWMIND_AUTH_MODE !== 'github') return reply.code(404).send();
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('redirect_uri', `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}/auth/github/callback`);
    reply.redirect(url.toString());
  });

  app.get<{ Querystring: { code?: string } }>('/auth/github/callback', async (req, reply) => {
    if (env.CLAWMIND_AUTH_MODE !== 'github') return reply.code(404).send();
    const code = req.query.code;
    if (!code) return reply.code(400).send({ error: 'missing code' });
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
      }),
    }).then((r) => r.json()) as { access_token?: string };
    if (!tokenRes.access_token) return reply.code(400).send({ error: 'oauth failed' });
    const ghUser = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${tokenRes.access_token}`, accept: 'application/json' },
    }).then((r) => r.json()) as { login: string; id: number };
    const allowed = env.CLAWMIND_ALLOWED_GITHUB_USERS.split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(ghUser.login)) {
      return reply.code(403).send({ error: 'not allowed' });
    }
    req.session.userId = `gh:${ghUser.id}`;
    req.session.github = ghUser.login;
    await app.clawmind.audit.write({ actor: req.session.userId, action: 'login', resource: 'github' });
    reply.redirect('/');
  });

  app.post('/auth/logout', async (req, reply) => {
    await req.session.destroy();
    reply.send({ ok: true });
  });

  app.get('/auth/me', async (req) => ({ user: req.user ?? null }));
};

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (role: 'owner' | 'reader') => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

export const authPlugin = fp(plugin, { name: 'auth' });
