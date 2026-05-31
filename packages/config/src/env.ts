import { cleanEnv, str, num, bool, port, url } from 'envalid';

export function loadEnv() {
  return cleanEnv(process.env, {
    NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),

    CLAWMIND_DATA_DIR: str({ default: './data' }),
    CLAWMIND_WORKSPACE: str({ default: '~/.openclaw/workspace' }),
    CLAWMIND_LOG_LEVEL: str({ choices: ['trace', 'debug', 'info', 'warn', 'error'], default: 'info' }),

    CLAWMIND_API_HOST: str({ default: '127.0.0.1' }),
    CLAWMIND_API_PORT: port({ default: 7410 }),
    CLAWMIND_API_CORS_ORIGIN: str({ default: 'http://127.0.0.1:7412' }),

    CLAWMIND_EMBED_URL: url({ default: 'http://127.0.0.1:7411' }),
    CLAWMIND_EMBED_MODEL: str({ default: 'mlx-community/bge-small-en-v1.5-4bit' }),
    CLAWMIND_EMBED_DIM: num({ default: 384 }),

    CLAWMIND_LLM_PRIMARY_URL: url({ default: 'http://127.0.0.1:8642/v1' }),
    CLAWMIND_LLM_PRIMARY_MODEL: str({ default: 'hermes-agent' }),
    CLAWMIND_LLM_FALLBACK_URL: url({ default: 'http://127.0.0.1:4141/v1' }),
    CLAWMIND_LLM_FALLBACK_MODEL: str({ default: 'copilot-gpt-4o' }),

    CLAWMIND_AUTH_MODE: str({ choices: ['single-user', 'github', 'oidc'], default: 'single-user' }),
    CLAWMIND_SESSION_SECRET: str({ default: 'dev-secret-change-me-32bytesxxxxxxxxxxxx' }),
    GITHUB_CLIENT_ID: str({ default: '' }),
    GITHUB_CLIENT_SECRET: str({ default: '' }),
    CLAWMIND_ALLOWED_GITHUB_USERS: str({ default: '' }),

    // Generic OIDC SSO. Works with any spec-compliant provider that exposes
    // a discovery document at `${issuer}/.well-known/openid-configuration`:
    // Google Workspace (issuer https://accounts.google.com), Okta
    // (https://<tenant>.okta.com), Azure AD / Entra ID
    // (https://login.microsoftonline.com/<tenant>/v2.0), Auth0, Keycloak.
    // Procurement reviewers expect SSO to be present and configurable per
    // deployment without code changes.
    //
    // Set CLAWMIND_AUTH_MODE=oidc to require SSO. If
    // CLAWMIND_OIDC_ALLOWED_DOMAINS is non-empty, only ID tokens whose
    // verified email ends in one of those domains may sign in. Leave empty
    // to allow any account the IdP returns.
    CLAWMIND_OIDC_ISSUER: str({ default: '' }),
    CLAWMIND_OIDC_CLIENT_ID: str({ default: '' }),
    CLAWMIND_OIDC_CLIENT_SECRET: str({ default: '' }),
    CLAWMIND_OIDC_REDIRECT_URI: str({ default: '' }),
    CLAWMIND_OIDC_ALLOWED_DOMAINS: str({ default: '' }),
    CLAWMIND_OIDC_SCOPES: str({ default: 'openid email profile' }),

    CLAWMIND_OTEL_ENABLED: bool({ default: false }),
    CLAWMIND_OTEL_ENDPOINT: str({ default: 'http://127.0.0.1:4318' }),

    // Sentry error tracking. DSN empty = disabled, no events sent. Sample
    // rate applies to performance traces only; errors are always captured
    // when the SDK is initialised.
    CLAWMIND_SENTRY_DSN: str({ default: '' }),
    CLAWMIND_SENTRY_ENVIRONMENT: str({ default: 'development' }),
    CLAWMIND_SENTRY_RELEASE: str({ default: '' }),
    CLAWMIND_SENTRY_TRACES_SAMPLE_RATE: num({ default: 0 }),

    // Audit log rotation. The AuditLog rotates the active file once it
    // exceeds CLAWMIND_AUDIT_MAX_BYTES and retains CLAWMIND_AUDIT_KEEP_FILES
    // rotated siblings (`audit.log.1`, `audit.log.2`, ...). Set max bytes
    // to 0 to disable rotation entirely. Defaults keep the active file
    // under ~32 MiB and retain 5 generations, which is ~192 MiB worst case.
    CLAWMIND_AUDIT_MAX_BYTES: num({ default: 32 * 1024 * 1024 }),
    CLAWMIND_AUDIT_KEEP_FILES: num({ default: 5 }),

    // HTTP Strict Transport Security. Opt-in because the default dev bind
    // is plain HTTP on 127.0.0.1; enabling HSTS there would pin browsers to
    // a scheme the local server cannot speak. Production deployments behind
    // a TLS ingress should set CLAWMIND_HSTS_ENABLED=true.
    CLAWMIND_HSTS_ENABLED: bool({ default: false }),
    CLAWMIND_HSTS_MAX_AGE_SECONDS: num({ default: 15552000 }),

    // Outbound webhook SSRF guard. By default the API rejects any webhook
    // URL that resolves to a private, loopback, link-local, CGNAT, multicast,
    // or reserved IP, and rejects cloud metadata hosts unconditionally. The
    // check runs both at registration (POST /v1/webhooks) and immediately
    // before every delivery attempt, so a tenant who flips DNS after the URL
    // is saved cannot reach internal targets. CLAWMIND_WEBHOOK_ALLOW_PRIVATE
    // is for local dev only; production should leave it off. Allowed ports
    // are comma-separated; the default mirrors what a sensible reverse proxy
    // exposes.
    CLAWMIND_WEBHOOK_ALLOW_PRIVATE: bool({ default: false }),
    CLAWMIND_WEBHOOK_ALLOWED_PORTS: str({ default: '80,443,8080,8443' }),
  });
}

export type AppEnv = ReturnType<typeof loadEnv>;
