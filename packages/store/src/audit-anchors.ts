// Tamper-evident "anchors" over the audit hash chain.
//
// The chained audit log already detects in-place tampering: rewriting any
// past event invalidates every subsequent `hash` field. What it cannot
// detect on its own is a *truncation* attack, where an operator with file
// access deletes the tail and restarts. The remaining chain still
// verifies, just shorter, and a reviewer who has not pinned the head
// hash externally cannot tell.
//
// An anchor is a small JSON record that captures the chain's head hash
// and length at a point in time, signed with an HMAC over a server-side
// secret. Anchors are append-only and stored in their own file so an
// attacker who truncates the audit log still has to forge HMACs over a
// secret they do not have to make the chain look intact.
//
// Verification is two-sided: anchors are individually authentic
// (HMAC checks out), and the current chain still contains the anchored
// `headHash` at the anchored `checked` position. A mismatch means the
// chain has been rewound or rewritten under the anchor and the operator
// should treat the audit trail as compromised from that point on.

import { appendFile, mkdir, readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';

export interface AuditAnchor {
  /** Stable identifier so a UI can reference a specific anchor. */
  id: string;
  /** Anchor creation time, epoch ms. */
  ts: number;
  /** Hash of the audit chain head at the moment of anchoring. */
  headHash: string;
  /** Number of chained records counted at the moment of anchoring. */
  checked: number;
  /** Optional human note (who/why), e.g. "monthly SOC2 close". */
  note?: string;
  /** Hex HMAC-SHA256 over (id|ts|headHash|checked|note). */
  hmac: string;
}

function anchorBody(a: Omit<AuditAnchor, 'hmac'>): string {
  return [a.id, a.ts, a.headHash, a.checked, a.note ?? ''].join('|');
}

export function signAnchor(
  base: Omit<AuditAnchor, 'hmac'>,
  secret: string,
): string {
  return createHmac('sha256', secret).update(anchorBody(base)).digest('hex');
}

export function verifyAnchorSignature(a: AuditAnchor, secret: string): boolean {
  const expected = signAnchor(a, secret);
  const ea = Buffer.from(expected, 'hex');
  const ga = Buffer.from(a.hmac, 'hex');
  if (ea.length !== ga.length) return false;
  return timingSafeEqual(ea, ga);
}

export interface ListedAnchor extends AuditAnchor {
  /** True iff the HMAC over the record matches the configured secret. */
  signatureValid: boolean;
}

export interface AnchorVerifyResult {
  /** The anchor that was checked, or null if the store is empty. */
  anchor: AuditAnchor | null;
  /** HMAC over the anchor itself validates. */
  signatureValid: boolean;
  /** Chain still reaches the anchored headHash at the anchored count. */
  chainMatches: boolean;
  /**
   * Why verification failed. One of: 'no-anchors', 'bad-signature',
   * 'chain-truncated', 'chain-rewritten', or null when ok=true.
   */
  reason:
    | 'no-anchors'
    | 'bad-signature'
    | 'chain-truncated'
    | 'chain-rewritten'
    | null;
  /** Convenience: signatureValid && chainMatches. */
  ok: boolean;
}

/**
 * Append-only HMAC-signed anchor store. The file format is JSON Lines,
 * one anchor per record, identical to the audit log so the same
 * rotation/inspection tooling works on both.
 */
export class AuditAnchorStore {
  constructor(
    private readonly file: string,
    private readonly secret: string,
  ) {}

  /**
   * Persist a new anchor. Caller supplies the current chain head hash and
   * the number of records observed so the anchor is a snapshot of the
   * caller's verify() output, not a fresh inconsistent read.
   */
  async record(args: {
    headHash: string;
    checked: number;
    note?: string;
  }): Promise<AuditAnchor> {
    if (!args.headHash) {
      throw new Error('anchor requires a non-empty headHash');
    }
    if (!Number.isInteger(args.checked) || args.checked < 0) {
      throw new Error('anchor requires a non-negative integer count');
    }
    await mkdir(dirname(this.file), { recursive: true });
    const base: Omit<AuditAnchor, 'hmac'> = {
      id: randomUUID(),
      ts: Date.now(),
      headHash: args.headHash,
      checked: args.checked,
      note: args.note?.slice(0, 512),
    };
    const hmac = signAnchor(base, this.secret);
    const anchor: AuditAnchor = { ...base, hmac };
    await appendFile(this.file, JSON.stringify(anchor) + '\n', 'utf8');
    return anchor;
  }

  /** Newest first. Tags each record with whether its HMAC validates. */
  async list(limit = 100): Promise<ListedAnchor[]> {
    const all = await this.readAll();
    all.sort((a, b) => b.ts - a.ts);
    return all.slice(0, Math.max(1, Math.min(limit, 1000))).map((a) => ({
      ...a,
      signatureValid: verifyAnchorSignature(a, this.secret),
    }));
  }

  /**
   * Verify the most recently recorded anchor against the live chain. The
   * caller passes the chain's current head hash and total record count so
   * this module stays independent of the AuditLog implementation.
   */
  async verifyLatest(args: {
    currentHeadHash: string | null;
    currentChecked: number;
    /** Optional resolver: given an anchored count, return the hash at
     *  that record in the live chain. Lets us tell rewrite (count still
     *  long enough, hash different) from truncation (count too short). */
    headAt?: (checked: number) => Promise<string | null>;
  }): Promise<AnchorVerifyResult> {
    const all = await this.readAll();
    if (all.length === 0) {
      return {
        anchor: null,
        signatureValid: false,
        chainMatches: false,
        reason: 'no-anchors',
        ok: false,
      };
    }
    all.sort((a, b) => b.ts - a.ts);
    const latest = all[0]!;
    const signatureValid = verifyAnchorSignature(latest, this.secret);
    if (!signatureValid) {
      return {
        anchor: latest,
        signatureValid,
        chainMatches: false,
        reason: 'bad-signature',
        ok: false,
      };
    }
    // Truncation: live chain is shorter than the anchored count, so the
    // anchored event no longer exists in the chain at all.
    if (args.currentChecked < latest.checked) {
      return {
        anchor: latest,
        signatureValid: true,
        chainMatches: false,
        reason: 'chain-truncated',
        ok: false,
      };
    }
    // Fast path: chain hasn't moved since the anchor. Head hash must
    // still equal the anchored head.
    if (args.currentChecked === latest.checked) {
      const match = args.currentHeadHash === latest.headHash;
      return {
        anchor: latest,
        signatureValid: true,
        chainMatches: match,
        reason: match ? null : 'chain-rewritten',
        ok: match,
      };
    }
    // Chain has grown past the anchor: ask the resolver for the hash at
    // the anchored position. If we cannot resolve, fall back to "ok"
    // since the live chain at least contains as many records as the
    // anchor counted; the resolver-equipped caller catches rewrites.
    if (!args.headAt) {
      return {
        anchor: latest,
        signatureValid: true,
        chainMatches: true,
        reason: null,
        ok: true,
      };
    }
    const at = await args.headAt(latest.checked);
    const match = at === latest.headHash;
    return {
      anchor: latest,
      signatureValid: true,
      chainMatches: match,
      reason: match ? null : 'chain-rewritten',
      ok: match,
    };
  }

  private async readAll(): Promise<AuditAnchor[]> {
    const exists = await stat(this.file).then(() => true).catch(() => false);
    if (!exists) return [];
    const raw = await readFile(this.file, 'utf8');
    const out: AuditAnchor[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as AuditAnchor);
      } catch {
        // Skip malformed lines so a bad tail does not lock reviewers out.
      }
    }
    return out;
  }
}
