import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

// Security headers plugin
//
// Adds a conservative, hand-rolled set of HTTP response headers that bring the
// API up to baseline enterprise security posture without pulling in another
// dependency. The defaults are tuned for a JSON API that never serves user
// supplied HTML, which lets us run a very tight Content-Security-Policy
// (default-src 'none') without breaking the web client (the web app is a
// separate Next.js origin and is not served by this Fastify process).
//
// HSTS is opt-in via CLAWMIND_HSTS_ENABLED because the dev default binds to
// 127.0.0.1 over plain HTTP, where pinning HSTS would brick local browsers.
// In production deployments behind a TLS-terminating ingress the operator
// sets the flag and the Strict-Transport-Security header is emitted.

export interface SecurityHeadersOptions {
  hstsEnabled?: boolean;
  hstsMaxAgeSeconds?: number;
  hstsIncludeSubDomains?: boolean;
  hstsPreload?: boolean;
  contentSecurityPolicy?: string | null;
  referrerPolicy?: string;
  permissionsPolicy?: string;
  frameOptions?: 'DENY' | 'SAMEORIGIN';
  crossOriginOpenerPolicy?: string;
  crossOriginResourcePolicy?: string;
}

export const DEFAULT_API_CSP =
  "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const DEFAULTS: Required<Omit<SecurityHeadersOptions, 'contentSecurityPolicy'>> & {
  contentSecurityPolicy: string | null;
} = {
  hstsEnabled: false,
  hstsMaxAgeSeconds: 15552000, // 180 days
  hstsIncludeSubDomains: true,
  hstsPreload: false,
  contentSecurityPolicy: DEFAULT_API_CSP,
  referrerPolicy: 'no-referrer',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  frameOptions: 'DENY',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
};

function buildHsts(opts: Required<Omit<SecurityHeadersOptions, 'contentSecurityPolicy'>>): string {
  const parts = [`max-age=${Math.max(0, Math.floor(opts.hstsMaxAgeSeconds))}`];
  if (opts.hstsIncludeSubDomains) parts.push('includeSubDomains');
  if (opts.hstsPreload) parts.push('preload');
  return parts.join('; ');
}

const plugin: FastifyPluginAsync<SecurityHeadersOptions> = async (app, opts) => {
  const merged = { ...DEFAULTS, ...opts } as Required<
    Omit<SecurityHeadersOptions, 'contentSecurityPolicy'>
  > & { contentSecurityPolicy: string | null };

  const hstsValue = merged.hstsEnabled ? buildHsts(merged) : null;

  app.addHook('onSend', async (_req: FastifyRequest, reply: FastifyReply, payload) => {
    // Always-on baseline. These are cheap, well-understood, and never
    // legitimately conflict with a pure JSON API.
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', merged.frameOptions);
    reply.header('referrer-policy', merged.referrerPolicy);
    reply.header('permissions-policy', merged.permissionsPolicy);
    reply.header('cross-origin-opener-policy', merged.crossOriginOpenerPolicy);
    reply.header('cross-origin-resource-policy', merged.crossOriginResourcePolicy);

    if (merged.contentSecurityPolicy) {
      reply.header('content-security-policy', merged.contentSecurityPolicy);
    }
    if (hstsValue) {
      reply.header('strict-transport-security', hstsValue);
    }
    return payload;
  });
};

export const securityHeadersPlugin = fp(plugin, { name: 'security-headers' });
