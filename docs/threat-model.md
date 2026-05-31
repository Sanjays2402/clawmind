# ClawMind threat model

This document is the answer we give procurement teams when they ask "what
have you actually thought about". It is intentionally specific to
ClawMind's deployment shape: a single Fastify API, a Next.js dashboard,
an embed sidecar, an LLM provider, and a LanceDB index, all running
behind a reverse proxy in one tenancy.

If you change auth, sessions, MFA, SSO, API keys, IP allowlists, audit
logging, webhooks, or the dependency graph, update the matching row here.

## Assets we protect

| Asset                       | Why it matters                                   |
|-----------------------------|--------------------------------------------------|
| User notes and embeddings   | Often confidential. Leakage is the worst case.  |
| Audit log                   | Tamper would erase accountability.              |
| Session cookies             | Bearer to the whole account.                    |
| API keys                    | Bearer to a scoped slice of the account.        |
| OIDC client secret          | Bearer to identity for the whole tenant.        |
| TOTP seeds and recovery codes | Bypass for the MFA control.                    |
| Webhook signing secret      | Lets an attacker forge events to customers.     |

## Trust boundaries

1. Public internet to reverse proxy (TLS terminates here).
2. Reverse proxy to API and web (intra-cluster, mTLS optional).
3. API to embed sidecar (loopback inside the pod or cluster network).
4. API to LLM provider (egress to a third party).
5. API to outbound webhooks (egress to customer-controlled URLs).
6. Operator shell to data volume (out-of-band, audited by the host).

## Adversaries we plan for

- Unauthenticated internet attacker probing for weak auth or open routes.
- Authenticated user trying to escalate or read another user's data.
- Compromised API key with a narrow scope set.
- Hostile webhook destination running internal-network rebinding attacks.
- Stolen laptop holding a live session cookie.
- Supply chain attacker shipping a poisoned npm dependency.
- Curious operator with shell on the host.

## Controls, mapped to STRIDE

### Spoofing identity
- Email plus password and magic link auth with bcrypt-hashed credentials.
- OIDC SSO with JWKS verification and domain allowlist (`services/oidc.ts`).
- TOTP MFA gates destructive routes (`services/mfa.ts`, see `docs/security.md`).
- Sessions are HTTP-only, SameSite=Lax cookies, rotated on privilege change.
- API keys are random 32-byte tokens, stored hashed, never echoed after issuance.

### Tampering
- Audit log is append-only JSON lines (`data/audit.log`), written on every mutation.
- Webhook payloads are HMAC-signed (`x-clawmind-signature`) with replay-defeating timestamps.
- All inputs validated with zod before any side effect runs.
- Lockfiles are pinned; pnpm audit gates CI at high severity; Dependabot auto-merges patches.

### Repudiation
- Every mutating route writes actor, action, resource, IP, and meta to the audit log.
- API key usage rows record key id, route, scope, and outcome.
- `GET /v1/audit` exposes the log to the owner with filters and CSV export.

### Information disclosure
- Cookies are HTTP-only and SameSite=Lax.
- Per-account IP allowlists gate session and API key auth (`plugins/ip-allowlist.ts`).
- `GET /v1/me/export` lets the user pull every record; `DELETE /v1/me/data` hard-deletes.
- Per-user retention sweeps purge old history and feedback (`routes/retention.ts`).
- Outbound webhooks go through an SSRF guard that blocks private IPs and DNS rebinding (`services/url-guard.ts`).
- Errors are structured and never leak stack traces to clients.

### Denial of service
- Per-key and per-account rate limits return `429` with `Retry-After` and `X-RateLimit-*` headers.
- Heavy routes (ask, ingest, maintenance) have separate, lower limits.
- Liveness (`/live`) is cheap so a flaky LLM does not restart pods.
- Readiness (`/ready`) returns 503 until the index is loaded so traffic does not land on a cold pod.

### Elevation of privilege
- Scope checks (`scopes.ts`, `requireScope`) on every API route, including new ones.
- Session cookies cannot call admin actions without MFA step-up.
- Recovery code use is logged and burns the code.
- Force-logout-all revokes every active session in one click.

## Things that are explicitly out of scope

- Cross-organisation tenancy. ClawMind is single-tenant per deployment;
  multi-tenant workspaces are not implemented and are not promised.
- Defending against a malicious operator with root on the host. We
  assume the host is trusted and rely on host controls for that surface.
- Hiding the existence of accounts from a network observer who can see
  TLS SNI; we rely on the reverse proxy to terminate TLS sanely.

## Reporting

Security issues go through `SECURITY.md`. Please do not file public
issues for suspected vulnerabilities.
