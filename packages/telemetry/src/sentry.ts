// Sentry wiring for the API. Kept dependency-free at module load time: the
// SDK is initialised only when a DSN is configured, so dev/test runs that do
// not opt in pay no startup cost and emit no events.

import * as Sentry from '@sentry/node';

export interface SentryInitOptions {
  dsn?: string;
  environment?: string;
  release?: string;
  serviceName: string;
  tracesSampleRate?: number;
  // Optional transport override, used by tests to capture events in memory
  // without needing a real DSN endpoint.
  transport?: (options: Sentry.NodeOptions) => {
    send: (envelope: unknown) => Promise<{ statusCode?: number } | void>;
    flush: (timeout?: number) => Promise<boolean>;
  };
}

let initialised = false;

export function isSentryEnabled(): boolean {
  return initialised;
}

export function initSentry(opts: SentryInitOptions): boolean {
  if (initialised) return true;
  if (!opts.dsn && !opts.transport) return false;
  Sentry.init({
    dsn: opts.dsn ?? 'https://test@example.invalid/0',
    environment: opts.environment,
    release: opts.release,
    serverName: opts.serviceName,
    tracesSampleRate: opts.tracesSampleRate ?? 0,
    // We rely on Fastify's logger for breadcrumbs, so skip the heavy
    // auto-instrumentations and keep the SDK lean. Callers that want HTTP
    // breadcrumbs can layer them on themselves.
    defaultIntegrations: false,
    transport: opts.transport as never,
  });
  initialised = true;
  return true;
}

export async function flushSentry(timeoutMs = 2000): Promise<boolean> {
  if (!initialised) return true;
  try {
    return await Sentry.flush(timeoutMs);
  } catch {
    return false;
  }
}

export function captureException(
  err: unknown,
  context?: Record<string, unknown>,
): string | undefined {
  if (!initialised) return undefined;
  return Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v as never);
      }
    }
    return Sentry.captureException(err);
  });
}

export function setUser(user: { id?: string | null; username?: string | null } | null): void {
  if (!initialised) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: user.id ?? undefined, username: user.username ?? undefined });
}

// Re-export the Sentry namespace for advanced callers (custom scopes, manual
// breadcrumbs). Most code should prefer the helpers above.
export { Sentry };
