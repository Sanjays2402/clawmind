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

    CLAWMIND_AUTH_MODE: str({ choices: ['single-user', 'github'], default: 'single-user' }),
    CLAWMIND_SESSION_SECRET: str({ default: 'dev-secret-change-me-32bytesxxxxxxxxxxxx' }),
    GITHUB_CLIENT_ID: str({ default: '' }),
    GITHUB_CLIENT_SECRET: str({ default: '' }),
    CLAWMIND_ALLOWED_GITHUB_USERS: str({ default: '' }),

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
  });
}

export type AppEnv = ReturnType<typeof loadEnv>;
