# Security

- All routes go through zod validation, rate limiting, audit logging.
- Session cookies are HTTP-only and same-site lax.
- Secrets live in env vars; nothing is committed.
- The Docker images run as a non-root user.
- The audit log is append-only JSON lines at `data/audit.log`.
- For multi-user mode, set `CLAWMIND_ALLOWED_GITHUB_USERS` so a stolen client secret cannot let strangers in.
