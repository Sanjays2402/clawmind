// Procurement Security Posture service.
//
// Aggregates the LIVE state of every workspace control into a single
// vendor-questionnaire-shaped JSON. Distinct from /v1/admin/overview
// (which is an operator dashboard with counters) and from /v1/trust
// (which is editable marketing): posture is a non-editable, derived
// scorecard whose only purpose is to answer the procurement checklist
// "is control X actually configured right now" yes/no/warn with a
// remediation hint for every failing item.
//
// Every entry maps to one or more SOC2 / ISO 27001 control families
// so a buyer's compliance team can paste the output straight into
// their vendor risk register.

import { getPolicy as getMfaPolicy } from './mfa-policy.js';
import { getPolicy as getSessionPolicy } from './session-policy.js';
import { getPolicy as getSharePolicy } from './share-policy.js';
import { getPolicy as getApiKeyPolicy } from './api-key-policy.js';
import { getPolicy as getDataResidency } from './data-residency.js';
import { getRecord as getWorkspaceIpAllowlist } from './workspace-ip-allowlist.js';
import { listDrains } from './audit-drains.js';
import { getFreeze } from './workspace-freeze.js';
import { getProfile as getTrustProfile } from './trust.js';
import { settingsFromEnv as oidcSettingsFromEnv, isConfigured as oidcIsConfigured } from './oidc.js';

export type ControlStatus = 'pass' | 'warn' | 'fail';

export interface ControlResult {
  id: string;
  title: string;
  status: ControlStatus;
  family: string; // SOC2 / ISO family hint
  detail: string;
  remediation: string | null;
}

export interface PostureReport {
  generatedAt: number;
  score: number; // 0..100, weighted pass=1, warn=0.5, fail=0
  counts: { pass: number; warn: number; fail: number; total: number };
  ready: boolean; // no fails AND warns <= 2
  controls: ControlResult[];
}

interface PostureInput {
  dataDir: string;
  env: Record<string, unknown>;
  auditVerified: boolean;
  auditHeadHash: string | null;
}

function pass(id: string, title: string, family: string, detail: string): ControlResult {
  return { id, title, status: 'pass', family, detail, remediation: null };
}
function warn(id: string, title: string, family: string, detail: string, remediation: string): ControlResult {
  return { id, title, status: 'warn', family, detail, remediation };
}
function fail(id: string, title: string, family: string, detail: string, remediation: string): ControlResult {
  return { id, title, status: 'fail', family, detail, remediation };
}

export async function buildPosture(input: PostureInput): Promise<PostureReport> {
  const { dataDir, env, auditVerified, auditHeadHash } = input;

  const [
    mfaPolicy,
    sessionPolicy,
    sharePolicy,
    apiKeyPolicy,
    dataRes,
    ipRec,
    drains,
    freeze,
    trust,
  ] = await Promise.all([
    getMfaPolicy(dataDir).catch(() => null),
    getSessionPolicy(dataDir).catch(() => null),
    getSharePolicy(dataDir).catch(() => null),
    getApiKeyPolicy(dataDir).catch(() => null),
    getDataResidency(dataDir).catch(() => null),
    getWorkspaceIpAllowlist(dataDir).catch(() => ({ enabled: false, rules: [] as unknown[] })),
    listDrains(dataDir).catch(() => [] as unknown[]),
    getFreeze(dataDir).catch(() => ({ active: false } as { active: boolean })),
    getTrustProfile(dataDir).catch(() => null),
  ]);

  const ssoSettings = oidcSettingsFromEnv(env as Parameters<typeof oidcSettingsFromEnv>[0]);
  const ssoOn = oidcIsConfigured(ssoSettings);

  const controls: ControlResult[] = [];

  // CC6.1 SSO
  controls.push(
    ssoOn
      ? pass('sso.oidc', 'OIDC SSO configured', 'SOC2 CC6.1', `Issuer ${ssoSettings?.issuer}`)
      : fail(
          'sso.oidc',
          'OIDC SSO configured',
          'SOC2 CC6.1',
          'No OIDC issuer/clientId in env; only local auth is in use',
          'Set CLAWMIND_OIDC_ISSUER + CLAWMIND_OIDC_CLIENT_ID/SECRET + CLAWMIND_OIDC_REDIRECT_URI',
        ),
  );

  // CC6.1 MFA policy enforced
  const mfaRequired = (mfaPolicy as { enforced?: boolean } | null)?.enforced === true;
  controls.push(
    mfaRequired
      ? pass('mfa.policy', 'Workspace MFA enforcement', 'SOC2 CC6.1', 'mfa-policy enabled')
      : warn(
          'mfa.policy',
          'Workspace MFA enforcement',
          'SOC2 CC6.1',
          'Workspace MFA enforcement is off (individual users may still enrol)',
          'POST /v1/mfa-policy {enabled:true} (owner + MFA + mfa-policy:admin)',
        ),
  );

  // CC6.6 IP allowlist
  const ipOn = Boolean((ipRec as { enabled?: boolean }).enabled);
  controls.push(
    ipOn
      ? pass('network.ip-allowlist', 'Workspace IP allowlist', 'SOC2 CC6.6', 'IP allowlist enabled')
      : warn(
          'network.ip-allowlist',
          'Workspace IP allowlist',
          'SOC2 CC6.6',
          'IP allowlist is not enabled',
          'PUT /v1/ip-allowlist {enabled:true, rules:[...]} (owner + MFA)',
        ),
  );

  // CC7.2 Audit drain (SIEM)
  const drainCount = Array.isArray(drains) ? drains.length : 0;
  controls.push(
    drainCount > 0
      ? pass(
          'observability.audit-drain',
          'Audit log SIEM drain configured',
          'SOC2 CC7.2',
          `${drainCount} drain(s) configured`,
        )
      : warn(
          'observability.audit-drain',
          'Audit log SIEM drain configured',
          'SOC2 CC7.2',
          'No SIEM drain configured; audit log lives only on disk',
          'POST /v1/audit-drains (owner + MFA + audit-drains:admin) with Splunk HEC, Datadog, or HMAC webhook',
        ),
  );

  // CC7.1 Audit chain integrity
  controls.push(
    auditVerified
      ? pass(
          'integrity.audit-chain',
          'Audit chain integrity',
          'SOC2 CC7.1',
          `Chain verified, head ${auditHeadHash?.slice(0, 12) ?? 'n/a'}`,
        )
      : fail(
          'integrity.audit-chain',
          'Audit chain integrity',
          'SOC2 CC7.1',
          'Audit chain verification failed on disk',
          'Run scripts/verify-audit-chain.ts and investigate broken segment',
        ),
  );

  // CC1.4 API key issuance policy
  controls.push(
    apiKeyPolicy && ((apiKeyPolicy as { maxTtlMinutes?: number }).maxTtlMinutes! > 0 || (apiKeyPolicy as { maxActiveKeysPerUser?: number }).maxActiveKeysPerUser! > 0)
      ? pass(
          'creds.api-key-policy',
          'API key issuance policy enforced',
          'SOC2 CC6.2',
          `TTL cap ${(apiKeyPolicy as { maxTtlMinutes?: number }).maxTtlMinutes ?? 0}m, per-user cap ${(apiKeyPolicy as { maxActiveKeysPerUser?: number }).maxActiveKeysPerUser ?? 0}`,
        )
      : warn(
          'creds.api-key-policy',
          'API key issuance policy enforced',
          'SOC2 CC6.2',
          'No workspace cap on key TTL or per-user count',
          'POST /v1/api-key-policy {maxTtlDays, maxKeysPerUser} (owner + MFA)',
        ),
  );

  // CC6.7 Session policy
  const sp = sessionPolicy as { maxLifetimeMinutes?: number; idleTimeoutMinutes?: number } | null;
  controls.push(
    sp && ((sp.maxLifetimeMinutes ?? 0) > 0 || (sp.idleTimeoutMinutes ?? 0) > 0)
      ? pass(
          'session.policy',
          'Session lifetime policy enforced',
          'SOC2 CC6.7',
          `max ${sp.maxLifetimeMinutes ?? 0}m / idle ${sp.idleTimeoutMinutes ?? 0}m`,
        )
      : warn(
          'session.policy',
          'Session lifetime policy enforced',
          'SOC2 CC6.7',
          'No session lifetime / idle policy',
          'PUT /v1/session-policy (owner + MFA + session-policy:admin)',
        ),
  );

  // CC9.2 Share policy (public sharing risk)
  const shp = sharePolicy as { disableShares?: boolean; requireExpiry?: boolean } | null;
  const shareHardened = Boolean(shp?.disableShares || shp?.requireExpiry);
  controls.push(
    shareHardened
      ? pass(
          'share.policy',
          'Public share policy hardened',
          'SOC2 CC9.2',
          shp?.disableShares ? 'public shares disabled' : 'requireExpiry on',
        )
      : warn(
          'share.policy',
          'Public share policy hardened',
          'SOC2 CC9.2',
          'public sharing is unrestricted: links can be minted without an expiry',
          'PUT /v1/share-policy {requireExpiry:true} or {disableShares:true} (owner + MFA + share-policy:admin)',
        ),
  );

  // C.5 Data residency
  controls.push(
    dataRes && Array.isArray((dataRes as { allowedRegions?: unknown[] }).allowedRegions) && (dataRes as { allowedRegions: unknown[] }).allowedRegions.length > 0
      ? pass(
          'residency.policy',
          'Data residency policy',
          'ISO 27017 / GDPR Art. 44',
          `${(dataRes as { allowedRegions: unknown[] }).allowedRegions.length} region(s) approved`,
        )
      : warn(
          'residency.policy',
          'Data residency policy',
          'ISO 27017 / GDPR Art. 44',
          'No allowed-regions list configured',
          'PUT /v1/data-residency {allowedRegions:["us-east-1",...]} (owner + MFA)',
        ),
  );

  // CC1.1 Trust Center
  const trustReady = trust && (trust.summary ?? '').trim().length > 0;
  controls.push(
    trustReady
      ? pass('trust.center', 'Public Trust Center populated', 'SOC2 CC1.1', 'Trust Center has summary')
      : warn(
          'trust.center',
          'Public Trust Center populated',
          'SOC2 CC1.1',
          'Trust Center has no published summary; procurement bots see an empty profile at /v1/trust',
          'PUT /v1/trust {summary, securityContactEmail, ...} (owner + MFA + trust:admin)',
        ),
  );

  // A.9 Workspace freeze armed (NOT active) is just informational
  controls.push(
    (freeze as { active?: boolean }).active
      ? warn(
          'workspace.freeze',
          'Workspace freeze',
          'SOC2 A1.2',
          'Workspace is currently frozen; mutating routes return 423',
          'POST /v1/workspace-freeze/unfreeze when investigation completes',
        )
      : pass(
          'workspace.freeze',
          'Workspace freeze',
          'SOC2 A1.2',
          'Kill switch available and currently inactive',
        ),
  );

  const counts = { pass: 0, warn: 0, fail: 0, total: controls.length };
  for (const c of controls) counts[c.status] += 1;
  const score = Math.round(
    (counts.pass * 100 + counts.warn * 50) / Math.max(controls.length, 1),
  );
  const ready = counts.fail === 0 && counts.warn <= 2;

  return {
    generatedAt: Date.now(),
    score,
    counts,
    ready,
    controls,
  };
}
