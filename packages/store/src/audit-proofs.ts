// Audit inclusion proofs.
//
// The on-disk audit log already chains records by SHA-256 so any in-place
// edit is detectable, and HMAC-signed anchors over the chain head catch
// truncation. What neither directly answers is a procurement-grade
// question that auditors ask repeatedly:
//
//   "Prove to me, offline, that this specific event was in your audit log
//    on this date and has not been altered since."
//
// An inclusion proof is a small, HMAC-signed certificate that pins one
// event to a specific position in the workspace's chain at the moment of
// issuance. The signature is computed over the event hash, its 1-indexed
// position, the chain head hash, the chain length, the issuance time,
// and the certificate id. Anyone holding the HMAC secret (the workspace
// itself, or an auditor given a long-term verifier copy) can:
//
//   1. Recompute SHA-256 over the event body and check it matches the
//      certificate's eventHash. Tamper with any field of the event and
//      this fails immediately.
//   2. Recompute the HMAC over the certificate body and check it matches.
//      Tamper with position, head hash, or chain length and this fails.
//
// The proof intentionally does not embed the full chain: that would leak
// other workspaces' events and bloat the certificate. The proof is a
// commitment, not a Merkle path, and pairs with the existing anchor +
// verify endpoints which already cover detection of chain tampering.

import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto';
import type { AuditEvent } from '@clawmind/types';
import { computeRecordHash } from './audit-log.js';

export interface AuditInclusionProof {
  /** Stable identifier for this proof. Useful to reference in a ticket. */
  id: string;
  /** Issuance time, epoch ms. */
  ts: number;
  /** The exact event being proven. Kept verbatim so the verifier can
   *  recompute its hash without a round trip to the server. */
  event: AuditEvent;
  /** Recomputed hash of `event`, redundantly stored so a verifier with
   *  no copy of computeRecordHash() can still spot a tampered event by
   *  checking eventHash === event.hash. */
  eventHash: string;
  /** 1-indexed chronological position of the event in the chain at the
   *  moment of issuance, across rotated log siblings. */
  position: number;
  /** Hash of the chain's current head at the moment of issuance. */
  chainHeadHash: string | null;
  /** Number of chained records observed at the moment of issuance. */
  chainChecked: number;
  /** Hex HMAC-SHA256 over the canonical proof body. */
  hmac: string;
}

function proofBody(p: Omit<AuditInclusionProof, 'hmac'>): string {
  // Pin the order. position and chainChecked are stringified as decimal
  // integers; null chainHeadHash is the literal empty string so the
  // canonical form stays simple.
  return [
    p.id,
    String(p.ts),
    p.eventHash,
    String(p.position),
    p.chainHeadHash ?? '',
    String(p.chainChecked),
  ].join('|');
}

export function signInclusionProof(
  base: Omit<AuditInclusionProof, 'hmac'>,
  secret: string,
): string {
  return createHmac('sha256', secret).update(proofBody(base)).digest('hex');
}

export interface InclusionProofVerifyResult {
  /** All three sub-checks passed. */
  ok: boolean;
  /** The recomputed event hash matches the stored eventHash and the
   *  embedded event.hash. Detects any tamper of the event body. */
  eventHashValid: boolean;
  /** The recomputed HMAC matches the certificate's hmac. Detects any
   *  tamper of position, chain head, or issuance time. */
  signatureValid: boolean;
  /** Human-readable reason on failure. */
  reason:
    | 'event-hash-mismatch'
    | 'bad-signature'
    | 'missing-event-hash'
    | null;
  /** The hash this verifier recomputed for the event, surfaced so a
   *  reviewer can compare it against the certificate by eye. */
  recomputedEventHash: string;
}

/**
 * Offline-friendly verifier. Does not touch any chain file. The verifier
 * needs the HMAC secret used to sign the proof and the AuditEvent schema
 * (already pinned in @clawmind/types). Returns a structured verdict so
 * UIs can render exactly which check failed.
 */
export function verifyInclusionProof(
  proof: AuditInclusionProof,
  secret: string,
): InclusionProofVerifyResult {
  // computeRecordHash expects the event without `hash` set, since the
  // hash chain commits to the body, not to its own digest.
  const recomputed = computeRecordHash({ ...proof.event, hash: undefined });

  if (!proof.event.hash) {
    return {
      ok: false,
      eventHashValid: false,
      signatureValid: false,
      reason: 'missing-event-hash',
      recomputedEventHash: recomputed,
    };
  }

  const eventHashValid =
    recomputed === proof.eventHash && recomputed === proof.event.hash;
  if (!eventHashValid) {
    return {
      ok: false,
      eventHashValid: false,
      signatureValid: false,
      reason: 'event-hash-mismatch',
      recomputedEventHash: recomputed,
    };
  }

  const expected = signInclusionProof(
    {
      id: proof.id,
      ts: proof.ts,
      event: proof.event,
      eventHash: proof.eventHash,
      position: proof.position,
      chainHeadHash: proof.chainHeadHash,
      chainChecked: proof.chainChecked,
    },
    secret,
  );
  const ea = Buffer.from(expected, 'hex');
  const ga = Buffer.from(proof.hmac, 'hex');
  const signatureValid =
    ea.length === ga.length && timingSafeEqual(ea, ga);

  if (!signatureValid) {
    return {
      ok: false,
      eventHashValid: true,
      signatureValid: false,
      reason: 'bad-signature',
      recomputedEventHash: recomputed,
    };
  }

  return {
    ok: true,
    eventHashValid: true,
    signatureValid: true,
    reason: null,
    recomputedEventHash: recomputed,
  };
}

export interface IssueProofInput {
  /** Locate the event by id by streaming the live chain. */
  eventId: string;
  /** Iterator over the chain in chronological order, used to find the
   *  event's 1-indexed position. */
  iterate: () => AsyncIterable<AuditEvent>;
  /** Snapshot of the chain head at the moment of issuance. */
  chainHeadHash: string | null;
  chainChecked: number;
  /** HMAC secret. */
  secret: string;
}

export type IssueProofResult =
  | { ok: true; proof: AuditInclusionProof }
  | { ok: false; reason: 'not-found' | 'missing-event-hash' };

/**
 * Build an inclusion certificate for a single event. The caller is
 * responsible for passing a freshly-snapshotted head hash and checked
 * count (typically from AuditLog.verify()) so the proof binds to a
 * consistent chain state.
 */
export async function issueInclusionProof(
  input: IssueProofInput,
): Promise<IssueProofResult> {
  let position = 0;
  let found: AuditEvent | null = null;
  for await (const ev of input.iterate()) {
    if (!ev.hash) {
      // Legacy pre-chain records are counted but cannot be proven; the
      // proof scheme requires a chained hash to commit to.
      position++;
      continue;
    }
    position++;
    if (ev.id === input.eventId) {
      found = ev;
      break;
    }
  }
  if (!found) {
    return { ok: false, reason: 'not-found' };
  }
  if (!found.hash) {
    return { ok: false, reason: 'missing-event-hash' };
  }
  const base: Omit<AuditInclusionProof, 'hmac'> = {
    id: randomUUID(),
    ts: Date.now(),
    event: found,
    eventHash: found.hash,
    position,
    chainHeadHash: input.chainHeadHash,
    chainChecked: input.chainChecked,
  };
  const hmac = signInclusionProof(base, input.secret);
  return { ok: true, proof: { ...base, hmac } };
}
