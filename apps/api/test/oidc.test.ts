import { afterAll, describe, it, expect } from 'vitest';
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { Agent, MockAgent, setGlobalDispatcher } from 'undici';
import {
  _resetCachesForTests,
  buildAuthorizationRequest,
  buildUserIdFromClaims,
  completeLogin,
  constantTimeStringEqual,
  domainAllowed,
  emailDomain,
  parseAllowedDomains,
  settingsFromEnv,
  verifyIdToken,
  type OidcSettings,
} from '../src/services/oidc.js';

function b64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf;
  return b.toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function signRs256(headerObj: object, payloadObj: object, privateKeyPem: string): string {
  const header = b64url(JSON.stringify(headerObj));
  const payload = b64url(JSON.stringify(payloadObj));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${header}.${payload}.${b64url(sig)}`;
}

function jwkFromPublicKey(pubKey: import('node:crypto').KeyObject, kid: string): Record<string, unknown> {
  const jwk = pubKey.export({ format: 'jwk' }) as Record<string, unknown>;
  return { ...jwk, kid, alg: 'RS256', use: 'sig' };
}

describe('oidc helpers', () => {
  it('parses comma-separated allowed domains and ignores blanks', () => {
    expect(parseAllowedDomains(' Acme.com, ,beta.test ,')).toEqual(['acme.com', 'beta.test']);
  });

  it('extracts email domain in a case-insensitive way', () => {
    expect(emailDomain('Sam@Example.COM')).toBe('example.com');
    expect(emailDomain('not-an-email')).toBeNull();
    expect(emailDomain(null)).toBeNull();
  });

  it('domainAllowed returns true when allowlist empty (open access)', () => {
    expect(domainAllowed('a@b.com', [])).toBe(true);
  });

  it('domainAllowed denies emails outside the allowlist', () => {
    expect(domainAllowed('a@evil.com', ['acme.com'])).toBe(false);
    expect(domainAllowed('a@acme.com', ['acme.com'])).toBe(true);
    expect(domainAllowed(null, ['acme.com'])).toBe(false);
  });

  it('constant-time string compare returns false for different lengths without throwing', () => {
    expect(constantTimeStringEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeStringEqual('abc', 'abc')).toBe(true);
    expect(constantTimeStringEqual('abc', 'abd')).toBe(false);
  });

  it('settingsFromEnv returns null when required vars are missing', () => {
    expect(
      settingsFromEnv({
        CLAWMIND_OIDC_ISSUER: '',
        CLAWMIND_OIDC_CLIENT_ID: 'x',
        CLAWMIND_OIDC_CLIENT_SECRET: 'y',
        CLAWMIND_OIDC_REDIRECT_URI: 'http://localhost/cb',
        CLAWMIND_OIDC_ALLOWED_DOMAINS: '',
        CLAWMIND_OIDC_SCOPES: '',
      }),
    ).toBeNull();
  });

  it('builds an authorization URL with state, nonce, and prompt', () => {
    const settings: OidcSettings = {
      issuer: 'https://idp.example.com',
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'http://localhost:7410/auth/oidc/callback',
      scopes: 'openid email profile',
      allowedDomains: [],
    };
    const doc = {
      issuer: 'https://idp.example.com',
      authorization_endpoint: 'https://idp.example.com/authorize',
      token_endpoint: 'https://idp.example.com/token',
      jwks_uri: 'https://idp.example.com/jwks',
    };
    const ar = buildAuthorizationRequest(settings, doc, { state: 'st', nonce: 'no' });
    const u = new URL(ar.url);
    expect(u.searchParams.get('response_type')).toBe('code');
    expect(u.searchParams.get('client_id')).toBe('cid');
    expect(u.searchParams.get('state')).toBe('st');
    expect(u.searchParams.get('nonce')).toBe('no');
    expect(u.searchParams.get('redirect_uri')).toBe(settings.redirectUri);
    expect(u.searchParams.get('scope')).toBe('openid email profile');
    expect(u.searchParams.get('prompt')).toBe('select_account');
  });
});

describe('id token verification', () => {
  const ISSUER = 'https://idp.test';
  const JWKS_URI = `${ISSUER}/jwks`;
  const AUD = 'client-abc';
  const kid = 'k1';
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privPem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  const jwk = jwkFromPublicKey(publicKey, kid);

  function setupMock(extraKeys: Array<Record<string, unknown>> = []) {
    _resetCachesForTests();
    const mock = new MockAgent();
    mock.disableNetConnect();
    setGlobalDispatcher(mock);
    const pool = mock.get(ISSUER);
    pool
      .intercept({ path: '/jwks', method: 'GET' })
      .reply(200, { keys: [jwk, ...extraKeys] }, { headers: { 'content-type': 'application/json' } })
      .persist();
    return mock;
  }

  afterAllRestore();

  it('accepts a valid RS256 id token with matching aud, iss, and nonce', async () => {
    setupMock();
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256(
      { alg: 'RS256', typ: 'JWT', kid },
      { iss: ISSUER, sub: 'u1', aud: AUD, exp: now + 300, iat: now, nonce: 'n1', email: 'sam@acme.com', email_verified: true },
      privPem,
    );
    const claims = await verifyIdToken(token, JWKS_URI, {
      expectedAudience: AUD,
      expectedIssuer: ISSUER,
      expectedNonce: 'n1',
    });
    expect(claims.sub).toBe('u1');
    expect(buildUserIdFromClaims(claims)).toBe('oidc:idp.test:u1');
  });

  it('rejects a token whose signature does not verify', async () => {
    setupMock();
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256(
      { alg: 'RS256', typ: 'JWT', kid },
      { iss: ISSUER, sub: 'u1', aud: AUD, exp: now + 300, iat: now, nonce: 'n1' },
      privPem,
    );
    // Tamper with the payload after signing: flip the last char before the
    // signature segment so the signature no longer matches.
    const parts = token.split('.');
    parts[1] = parts[1]!.slice(0, -1) + (parts[1]!.endsWith('a') ? 'b' : 'a');
    await expect(
      verifyIdToken(parts.join('.'), JWKS_URI, {
        expectedAudience: AUD,
        expectedIssuer: ISSUER,
        expectedNonce: 'n1',
      }),
    ).rejects.toThrow(/signature/);
  });

  it('rejects a token whose nonce does not match', async () => {
    setupMock();
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256(
      { alg: 'RS256', typ: 'JWT', kid },
      { iss: ISSUER, sub: 'u1', aud: AUD, exp: now + 300, iat: now, nonce: 'NOT-MINE' },
      privPem,
    );
    await expect(
      verifyIdToken(token, JWKS_URI, {
        expectedAudience: AUD,
        expectedIssuer: ISSUER,
        expectedNonce: 'expected-nonce',
      }),
    ).rejects.toThrow(/nonce/);
  });

  it('rejects an expired token', async () => {
    setupMock();
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256(
      { alg: 'RS256', typ: 'JWT', kid },
      { iss: ISSUER, sub: 'u1', aud: AUD, exp: now - 3600, iat: now - 7200 },
      privPem,
    );
    await expect(
      verifyIdToken(token, JWKS_URI, { expectedAudience: AUD, expectedIssuer: ISSUER }),
    ).rejects.toThrow(/expired/);
  });

  it('rejects a token signed for the wrong audience (cross-tenant proof)', async () => {
    setupMock();
    const now = Math.floor(Date.now() / 1000);
    const token = signRs256(
      { alg: 'RS256', typ: 'JWT', kid },
      { iss: ISSUER, sub: 'u1', aud: 'some-other-app', exp: now + 300, iat: now },
      privPem,
    );
    await expect(
      verifyIdToken(token, JWKS_URI, { expectedAudience: AUD, expectedIssuer: ISSUER }),
    ).rejects.toThrow(/audience/);
  });

  it('completeLogin enforces the workspace email-domain policy', async () => {
    _resetCachesForTests();
    const mock = new MockAgent();
    mock.disableNetConnect();
    setGlobalDispatcher(mock);
    const pool = mock.get(ISSUER);
    pool
      .intercept({ path: '/.well-known/openid-configuration', method: 'GET' })
      .reply(
        200,
        {
          issuer: ISSUER,
          authorization_endpoint: `${ISSUER}/authorize`,
          token_endpoint: `${ISSUER}/token`,
          jwks_uri: JWKS_URI,
        },
        { headers: { 'content-type': 'application/json' } },
      )
      .persist();
    pool
      .intercept({ path: '/jwks', method: 'GET' })
      .reply(200, { keys: [jwk] }, { headers: { 'content-type': 'application/json' } })
      .persist();

    const now = Math.floor(Date.now() / 1000);
    const idToken = signRs256(
      { alg: 'RS256', typ: 'JWT', kid },
      { iss: ISSUER, sub: 'u1', aud: AUD, exp: now + 300, iat: now, nonce: 'n1', email: 'evil@bad.com', email_verified: true },
      privPem,
    );
    pool
      .intercept({ path: '/token', method: 'POST' })
      .reply(200, { id_token: idToken, token_type: 'Bearer' }, { headers: { 'content-type': 'application/json' } });

    const settings: OidcSettings = {
      issuer: ISSUER,
      clientId: AUD,
      clientSecret: 'sec',
      redirectUri: 'http://localhost/cb',
      scopes: 'openid email profile',
      allowedDomains: ['acme.com'],
    };
    await expect(completeLogin(settings, 'CODE', 'n1')).rejects.toThrow(/domain not allowed/);
  });
});

// Restore the real dispatcher after the file finishes so other suites that
// share the process keep working.
afterAll(() => {
  setGlobalDispatcher(new Agent());
  _resetCachesForTests();
});

function afterAllRestore() {
  // kept for backwards compatibility with the in-describe call site below
}

// silence unused-import warnings
void createHash;
void randomBytes;
