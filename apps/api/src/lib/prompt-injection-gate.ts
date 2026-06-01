import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  activeRules,
  getPolicy,
  scanText,
  type MatchedFlag,
  type PolicyMode,
} from '../services/prompt-injection-policy.js';

export interface SourceLike {
  id: string;
  excerpt?: string | null;
  text?: string | null;
}

export interface InjectionFlaggedSource<S> {
  source: S;
  flags: MatchedFlag[];
}

export interface ScanResult<S extends SourceLike> {
  /** Effective policy mode at scan time. */
  mode: PolicyMode;
  /** All flagged sources (empty when no rule fired). */
  flagged: InjectionFlaggedSource<S>[];
  /** Sources annotated with `injectionFlags` (only present when non-empty). */
  annotated: Array<S & { injectionFlags?: MatchedFlag[] }>;
}

// Scan a list of retrieved sources against the workspace policy. The
// caller decides what to do with the result: in `block` mode they
// short-circuit with 422 via {@link enforceInjectionGate}; in `flag`
// mode they include `injectionFlags` in the response body; in
// `monitor` mode they audit silently. `off` returns the inputs
// untouched with no audit entries.
export async function scanSources<S extends SourceLike>(
  app: FastifyInstance,
  userId: string,
  route: string,
  sources: S[],
): Promise<ScanResult<S>> {
  const policy = await getPolicy(app.clawmind.dataDir);
  if (policy.mode === 'off' || sources.length === 0) {
    return { mode: policy.mode, flagged: [], annotated: sources };
  }
  const rules = await activeRules(app.clawmind.dataDir);
  if (rules.length === 0) {
    return { mode: policy.mode, flagged: [], annotated: sources };
  }
  const flagged: InjectionFlaggedSource<S>[] = [];
  const annotated = sources.map((s) => {
    const body = s.excerpt ?? s.text ?? '';
    const flags = scanText(body, rules);
    if (flags.length === 0) return s;
    flagged.push({ source: s, flags });
    return { ...s, injectionFlags: flags };
  });

  if (flagged.length > 0) {
    // Audit per call, not per source, so 100 hits on one corpus do
    // not produce 100 audit rows. We record `sourceIds` + per-source
    // `ruleId` sets but never the matched text.
    await app.clawmind.audit.write({
      actor: userId,
      action: 'prompt-injection.detected',
      resource: route,
      meta: {
        mode: policy.mode,
        sourceCount: flagged.length,
        sources: flagged.map((f) => ({
          id: f.source.id,
          ruleIds: f.flags.map((x) => x.ruleId),
          severity: f.flags.reduce<string>(
            (acc, cur) =>
              acc === 'high' || cur.severity === 'high'
                ? 'high'
                : acc === 'med' || cur.severity === 'med'
                  ? 'med'
                  : 'low',
            'low',
          ),
        })),
      },
    });
  }

  return { mode: policy.mode, flagged, annotated };
}

// Convenience used by routes that fail-closed in `block` mode. Returns
// `true` if the caller should continue, `false` if the gate has
// already replied with 422 and the route handler must return.
//
// `flag` / `monitor` / `off` are non-fatal here: those callers should
// use {@link scanSources} directly so they can attach the flag set to
// the response body. This helper exists for code paths (eg. streaming)
// where annotating partial output is impractical.
export async function enforceInjectionBlock<S extends SourceLike>(
  app: FastifyInstance,
  reply: FastifyReply,
  userId: string,
  route: string,
  sources: S[],
): Promise<{ ok: true; result: ScanResult<S> } | { ok: false }> {
  const result = await scanSources(app, userId, route, sources);
  if (result.mode === 'block' && result.flagged.length > 0) {
    reply.code(422).send({
      error: 'injection-detected',
      message:
        'Retrieved context contains content matching the workspace prompt-injection policy. The response was withheld.',
      sourceIds: result.flagged.map((f) => f.source.id),
    });
    return { ok: false };
  }
  return { ok: true, result };
}
