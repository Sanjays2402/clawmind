# Security

- All routes go through zod validation, rate limiting, audit logging.
- Session cookies are HTTP-only and same-site lax.
- Secrets live in env vars; nothing is committed.
- The Docker images run as a non-root user.
- The audit log is append-only JSON lines at `data/audit.log`.
- For multi-user mode, set `CLAWMIND_ALLOWED_GITHUB_USERS` so a stolen client secret cannot let strangers in.

## Multi-factor authentication

ClawMind supports TOTP (RFC 6238) MFA for owner accounts. Once a user
enrolls at `/settings/mfa` the following routes require a recent step-up
(default window: 15 minutes after the most recent successful verify):

- `POST /v1/keys`, `DELETE /v1/keys/:id`, `POST /v1/keys/:id/rotate`
- `DELETE /v1/me/data`
- `PUT /v1/ip-allowlist`
- `POST /v1/maintenance/compact`, `POST /v1/maintenance/forget`
- `DELETE /v1/sessions/:id`, `POST /v1/sessions/revoke-all`
- `POST|PATCH|DELETE /v1/webhooks/:id`, `POST /v1/webhooks/:id/test`, `POST /v1/webhooks/deliveries/:id/redeliver`

API key callers bypass MFA: their authorization is the scope set bound to
the key. Failed verifications and recovery-code use are written to the audit
log with actor, action, and (when known) the verification method.

