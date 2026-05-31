// Offboarding sweep.
//
// When a workspace member is removed (manually via the members route, or by
// SCIM deprovisioning) their long-lived credentials must be terminated in the
// same operation. Otherwise an attacker holding a copy of that user's API key
// or session cookie keeps full access to the workspace after the member row
// is gone, which is the textbook "dangling credential" finding that
// procurement security reviews fail a vendor on.
//
// This module concentrates the cleanup so the two callsites (members route,
// SCIM) cannot accidentally drift. It also exposes a discovery helper used by
// the admin console to flag any pre-existing orphans (keys whose userId is
// no longer in the member registry), letting an owner sweep historical
// debris from before this code shipped.

import { loadKeys, revokeKey, revokeKeysWhere } from './api-keys.js';
import { revokeAllForUser as revokeAllSessionsForUser } from './sessions.js';
import { listMembers } from './members.js';

export interface OffboardResult {
  /** Number of previously-active API keys that were revoked. */
  keysRevoked: number;
  /** Ids of the revoked keys (for audit + UI). */
  keyIds: string[];
  /** Number of previously-active sessions that were revoked. */
  sessionsRevoked: number;
}

/**
 * Revoke every active API key owned by userId and every active session.
 *
 * Safe to call repeatedly. Already-revoked credentials are skipped. Returns
 * counters so the caller can write a single audit row describing the sweep.
 */
export async function sweepUser(dataDir: string, userId: string): Promise<OffboardResult> {
  const { ids: revokedIds } = await revokeKeysWhere(dataDir, (k) => k.userId === userId);
  const { revoked: sessionsRevoked } = await revokeAllSessionsForUser(dataDir, userId, undefined);
  return { keysRevoked: revokedIds.length, keyIds: revokedIds, sessionsRevoked };
}

export interface OrphanedKey {
  id: string;
  userId: string;
  label: string;
  role: 'owner' | 'reader';
  createdAt: number;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

/**
 * Return every active API key whose owning userId is not a current member of
 * the workspace. These are historical orphans created before the offboarding
 * sweep landed, or any key that was issued for a user the registry no longer
 * recognises for any reason.
 */
export async function findOrphanedKeys(dataDir: string): Promise<OrphanedKey[]> {
  const [members, keys] = await Promise.all([listMembers(dataDir), loadKeys(dataDir)]);
  const known = new Set(members.map((m) => m.userId));
  // The bootstrap single-user identity is implicit and never appears in the
  // members file. Treat it as known so the admin view does not flag keys
  // owned by the local operator on a fresh install.
  known.add('local');
  return keys
    .filter((k) => !k.revokedAt && !known.has(k.userId))
    .map((k) => ({
      id: k.id,
      userId: k.userId,
      label: k.label,
      role: k.role,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      expiresAt: k.expiresAt,
    }));
}

/**
 * Revoke a specific orphaned key. Returns true if the key was revoked, false
 * if it was not found, already revoked, or still owned by a current member
 * (the caller should refresh and try again).
 */
export async function revokeOrphanedKey(
  dataDir: string,
  keyId: string,
): Promise<{ ok: boolean; reason?: 'not-found' | 'already-revoked' | 'still-member' }> {
  const [members, keys] = await Promise.all([listMembers(dataDir), loadKeys(dataDir)]);
  const known = new Set(members.map((m) => m.userId));
  known.add('local');
  const k = keys.find((kk) => kk.id === keyId);
  if (!k) return { ok: false, reason: 'not-found' };
  if (k.revokedAt) return { ok: false, reason: 'already-revoked' };
  if (known.has(k.userId)) return { ok: false, reason: 'still-member' };
  // Use the scoped revokeKey to keep the write going through the single
  // serialised writer in api-keys.ts.
  await revokeKey(dataDir, k.userId, k.id);
  return { ok: true };
}
