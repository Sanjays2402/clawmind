// OIDC SSO support for ClawMind.
//
// This module is intentionally framework-free (no Fastify imports) so the
// auth plugin can wire it into routes and the test suite can exercise the
// security-critical bits (state, nonce, domain allowlist, ID token signature
// + claims verification) without spinning up an HTTP server.
//
// We deliberately avoid a heavy OIDC client dependency. The protocol surface
// we need to support is small (authorization code flow + ID token check
// against the IdP's JWKS) and tying ourselves to a 3rd-party client is a
// supply-chain risk procurement teams ask about. The discovery document is
// cached in-memory for an hour so we are not hammering the IdP on every
// callback; JWKS keys are cached for the same window and re-fetched on
// signature miss to handle key rotation.

import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto';
import { request } from 'undici';

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string;
  allowedDomains: string[];
}

export interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  id_token_signing_alg_values_supported?: string[];
  end_session_endpoint?: string;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  hd?: string; // Google Workspace hosted domain hint
}

export interface OidcLoginResult {
  userId: string;
  email: string | null;
  emailVerified: boolean;
  name: string | null;
  claims: IdTokenClaims;
}

const DISCOVERY_TTL_MS = 60 * 60 * 1000;
const discoveryCache = new Map<string, { at: number; doc: OidcDiscovery }>();
const jwksCache = new Map<string, { at: number; keys: Map<string, KeyObject> }>();

export function parseAllowedDomains(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function settingsFromEnv(env: {
  CLAWMIND_OIDC_ISSUER: string;
  CLAWMIND_OIDC_CLIENT_ID: string;
  CLAWMIND_OIDC_CLIENT_SECRET: string;
  CLAWMIND_OIDC_REDIRECT_URI: string;
  CLAWMIND_OIDC_ALLOWED_DOMAINS: string;
  CLAWMIND_OIDC_SCOPES: string;
}): OidcSettings | null {
  if (!env.CLAWMIND_OIDC_ISSUER || !env.CLAWMIND_OIDC_CLIENT_ID || !env.CLAWMIND_OIDC_CLIENT_SECRET) {
    return null;
  }
  return {
    issuer: env.CLAWMIND_OIDC_ISSUER.replace(/\/$/, ''),
    clientId: env.CLAWMIND_OIDC_CLIENT_ID,
    clientSecret: env.CLAWMIND_OIDC_CLIENT_SECRET,
    redirectUri: env.CLAWMIND_OIDC_REDIRECT_URI,
    scopes: env.CLAWMIND_OIDC_SCOPES || 'openid email profile',
    allowedDomains: parseAllowedDomains(env.CLAWMIND_OIDC_ALLOWED_DOMAINS),
  };
}

export function isConfigured(settings: OidcSettings | null): settings is OidcSettings {
  return Boolean(settings && settings.issuer && settings.clientId && settings.clientSecret && settings.redirectUri);
}

export async function discover(issuer: string): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.doc;
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const res = await request(url, { method: 'GET' });
  if (res.statusCode !== 200) {
    throw new Error(`oidc discovery failed: ${res.statusCode}`);
  }
  const doc = (await res.body.json()) as OidcDiscovery;
  if (!doc.issuer || !doc.authorization_endpoint || !doc.token_endpoint || !doc.jwks_uri) {
    throw new Error('oidc discovery document missing required fields');
  }
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

async function loadJwks(jwksUri: string, forceRefresh = false): Promise<Map<string, KeyObject>> {
  const cached = jwksCache.get(jwksUri);
  if (!forceRefresh && cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.keys;
  const res = await request(jwksUri, { method: 'GET' });
  if (res.statusCode !== 200) throw new Error(`jwks fetch failed: ${res.statusCode}`);
  const body = (await res.body.json()) as { keys: Array<Record<string, unknown>> };
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    const kid = jwk.kid as string | undefined;
    const kty = jwk.kty as string | undefined;
    if (!kid || !kty) continue;
    try {
      const key = createPublicKey({ key: jwk as never, format: 'jwk' });
      keys.set(kid, key);
    } catch {
      // skip unsupported key formats; we still pick up the rest
    }
  }
  jwksCache.set(jwksUri, { at: Date.now(), keys });
  return keys;
}

function base64UrlDecode(input: string): Buffer {
  // pad and translate URL-safe alphabet back to standard base64
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export interface VerifyOptions {
  expectedAudience: string;
  expectedIssuer: string;
  expectedNonce?: string;
  now?: number; // override for tests
  clockSkewSec?: number;
}

export async function verifyIdToken(
  token: string,
  jwksUri: string,
  opts: VerifyOptions,
): Promise<IdTokenClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('id token malformed');
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];
  const header = JSON.parse(base64UrlDecode(headerB64).toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  const claims = JSON.parse(base64UrlDecode(payloadB64).toString('utf8')) as IdTokenClaims;

  if (header.alg !== 'RS256') {
    throw new Error(`unsupported id token alg: ${header.alg ?? 'unknown'}`);
  }
  if (!header.kid) throw new Error('id token missing kid');

  let keys = await loadJwks(jwksUri);
  let key = keys.get(header.kid);
  if (!key) {
    // signing keys rotate; refresh once before giving up
    keys = await loadJwks(jwksUri, true);
    key = keys.get(header.kid);
  }
  if (!key) throw new Error(`id token kid not found in jwks: ${header.kid}`);

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();
  const sig = base64UrlDecode(sigB64);
  if (!verifier.verify(key, sig)) {
    throw new Error('id token signature invalid');
  }

  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const skew = opts.clockSkewSec ?? 60;
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new Error('id token expired');
  if (typeof claims.iat !== 'number' || claims.iat - skew > now) throw new Error('id token issued in the future');
  if (claims.iss !== opts.expectedIssuer) throw new Error('id token issuer mismatch');
  const audOk = Array.isArray(claims.aud)
    ? claims.aud.includes(opts.expectedAudience)
    : claims.aud === opts.expectedAudience;
  if (!audOk) throw new Error('id token audience mismatch');
  if (opts.expectedNonce !== undefined && claims.nonce !== opts.expectedNonce) {
    throw new Error('id token nonce mismatch');
  }

  return claims;
}

export function emailDomain(email: string | undefined | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  if (at < 0) return null;
  return email.slice(at + 1).toLowerCase();
}

export function domainAllowed(email: string | undefined | null, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const d = emailDomain(email);
  return d !== null && allowed.includes(d);
}

export interface AuthorizationRequest {
  url: string;
  state: string;
  nonce: string;
}

export function buildAuthorizationRequest(
  settings: OidcSettings,
  discoveryDoc: OidcDiscovery,
  opts?: { state?: string; nonce?: string },
): AuthorizationRequest {
  const state = opts?.state ?? randomBytes(24).toString('hex');
  const nonce = opts?.nonce ?? randomBytes(24).toString('hex');
  const url = new URL(discoveryDoc.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', settings.clientId);
  url.searchParams.set('redirect_uri', settings.redirectUri);
  url.searchParams.set('scope', settings.scopes);
  url.searchParams.set('state', state);
  url.searchParams.set('nonce', nonce);
  url.searchParams.set('prompt', 'select_account');
  return { url: url.toString(), state, nonce };
}

export function constantTimeStringEqual(a: string, b: string): boolean {
  // timingSafeEqual requires equal-length buffers; pad with a deterministic
  // sentinel and always compare so the failure path is the same length as
  // the success path
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    // still consume work so attackers cannot use response time to learn the
    // length of the expected value
    timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export async function exchangeCode(
  settings: OidcSettings,
  discoveryDoc: OidcDiscovery,
  code: string,
): Promise<{ id_token: string; access_token?: string; token_type?: string }> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: settings.redirectUri,
    client_id: settings.clientId,
    client_secret: settings.clientSecret,
  });
  const res = await request(discoveryDoc.token_endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: body.toString(),
  });
  if (res.statusCode !== 200) {
    const text = await res.body.text();
    throw new Error(`oidc token exchange failed: ${res.statusCode} ${text.slice(0, 200)}`);
  }
  const json = (await res.body.json()) as { id_token?: string; access_token?: string; token_type?: string };
  if (!json.id_token) throw new Error('oidc token response missing id_token');
  return { id_token: json.id_token, access_token: json.access_token, token_type: json.token_type };
}

export function buildUserIdFromClaims(claims: IdTokenClaims): string {
  // We key the local user identity on `iss + sub` because `sub` is only
  // unique within an issuer. Switching IdPs without re-keying would
  // otherwise collide two unrelated accounts.
  const issShort = claims.iss.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `oidc:${issShort}:${claims.sub}`;
}

// Public entry point: given a raw callback code + the state/nonce we put in
// the cookie, do the full exchange + verify and return a normalised user.
export async function completeLogin(
  settings: OidcSettings,
  code: string,
  expectedNonce: string,
): Promise<OidcLoginResult> {
  const doc = await discover(settings.issuer);
  const { id_token } = await exchangeCode(settings, doc, code);
  const claims = await verifyIdToken(id_token, doc.jwks_uri, {
    expectedAudience: settings.clientId,
    expectedIssuer: doc.issuer,
    expectedNonce,
  });
  if (!domainAllowed(claims.email, settings.allowedDomains)) {
    throw new Error('email domain not allowed by workspace policy');
  }
  return {
    userId: buildUserIdFromClaims(claims),
    email: claims.email ?? null,
    emailVerified: claims.email_verified === true,
    name: claims.name ?? claims.preferred_username ?? null,
    claims,
  };
}

// Cache utilities exported for tests so they can simulate key rotation /
// discovery refreshes deterministically.
export function _resetCachesForTests(): void {
  discoveryCache.clear();
  jwksCache.clear();
}
