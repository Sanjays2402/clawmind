import pino from 'pino';

export function createLogger(opts?: { name?: string; level?: string }) {
  const level = opts?.level ?? process.env.CLAWMIND_LOG_LEVEL ?? 'info';
  return pino({
    name: opts?.name ?? 'clawmind',
    level,
    base: { service: 'clawmind' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: ['req.headers.authorization', 'req.headers.cookie', '*.token', '*.password'],
  });
}

export type Logger = ReturnType<typeof createLogger>;
