import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

// Workspace Trust Center.
//
// Procurement and security reviewers ask for the same handful of facts
// before they will engage past first contact: who owns security, what
// compliance frameworks are in scope, how to report a vulnerability,
// what's encrypted, where data sits, who else touches it. Today those
// answers live in scattered PDFs and email threads. This service is the
// single, owner-edited source of truth that backs three surfaces:
//
//   - GET /v1/trust              public JSON for buyer's vendor reviews
//   - /trust on the web app      public HTML page DPAs can cite by URL
//   - /.well-known/security.txt  RFC 9116 vulnerability disclosure
//
// Storage is a single JSON document under the workspace data dir. Tiny,
// hand-auditable, no migration. Every mutation funnels through this
// service so the audit chain entry and the file write are coupled.
//
// The public projection strips operator-only metadata (private notes,
// last-edited-by user id) so an internet-exposed instance cannot leak
// internal context to drive-by scrapers.

export type ComplianceStatus = 'in_progress' | 'achieved' | 'not_pursued';

export interface ComplianceFramework {
  // Short label as it should appear on the trust page, e.g. "SOC 2 Type II".
  name: string;
  status: ComplianceStatus;
  // ISO date the most recent report / certificate was issued. Optional;
  // a framework can be 'in_progress' without an issued date.
  issuedAt: string | null;
  // Auditor or certifying body, e.g. "Prescient Assurance". Optional.
  auditor: string | null;
  // Public URL to the report (commonly behind an NDA portal). Optional.
  reportUrl: string | null;
}

export interface TrustLink {
  // Short label, e.g. "Privacy Policy", "DPA Template", "Whitepaper".
  label: string;
  url: string;
}

export interface TrustProfile {
  // Free-form summary shown above the framework grid. Markdown not
  // rendered; treated as plain text to avoid an XSS surface on the
  // public page. Owners can leave this empty.
  summary: string;
  // Routable mailbox for security questions. Surfaced on the public
  // page AND in /.well-known/security.txt so researchers always have
  // an addressable contact.
  securityContactEmail: string | null;
  // RFC 9116 vulnerability reporting policy URL. Surfaces as the
  // Policy: field in security.txt when set.
  vulnerabilityPolicyUrl: string | null;
  // Compliance frameworks, in display order. Empty list is valid:
  // a young workspace can publish a trust page that says "audits in
  // progress" without inventing a SOC 2 it does not yet hold.
  frameworks: ComplianceFramework[];
  // One-line answers to the boilerplate procurement questionnaire.
  // All optional: a freshly installed workspace gets a coherent
  // page even before anyone fills these in.
  encryptionAtRest: string | null;
  encryptionInTransit: string | null;
  dataResidency: string | null;
  // Free-form additional resources the trust page should link to.
  // Bounded so an attacker who somehow got owner credentials cannot
  // turn the public page into a spam hosting service.
  links: TrustLink[];
  updatedAt: number;
  updatedBy: string | null;
}

export interface ComplianceFrameworkInput {
  name: string;
  status: ComplianceStatus;
  issuedAt?: string | null;
  auditor?: string | null;
  reportUrl?: string | null;
}

export interface TrustProfileInput {
  summary?: string;
  securityContactEmail?: string | null;
  vulnerabilityPolicyUrl?: string | null;
  frameworks?: ComplianceFrameworkInput[];
  encryptionAtRest?: string | null;
  encryptionInTransit?: string | null;
  dataResidency?: string | null;
  links?: TrustLink[];
}

export class TrustValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrustValidationError';
  }
}

export const TRUST_LIMITS = Object.freeze({
  summary: 4000,
  email: 320,
  url: 500,
  frameworkName: 120,
  auditor: 200,
  encryptionField: 500,
  residency: 500,
  linkLabel: 80,
  maxFrameworks: 24,
  maxLinks: 16,
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(msg: string): never {
  throw new TrustValidationError(msg);
}

function checkUrl(field: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > TRUST_LIMITS.url) fail(`${field} too long`);
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') fail(`${field} must be http(s)`);
    return u.toString();
  } catch {
    fail(`${field} must be a valid URL`);
  }
}

function checkEmail(field: string, value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > TRUST_LIMITS.email) fail(`${field} too long`);
  if (!EMAIL_RE.test(trimmed)) fail(`${field} must be a valid email`);
  return trimmed;
}

function emptyProfile(now: number): TrustProfile {
  return {
    summary: '',
    securityContactEmail: null,
    vulnerabilityPolicyUrl: null,
    frameworks: [],
    encryptionAtRest: null,
    encryptionInTransit: null,
    dataResidency: null,
    links: [],
    updatedAt: now,
    updatedBy: null,
  };
}

function file(dataDir: string): string {
  return join(dataDir, 'trust-profile.json');
}

async function readProfile(dataDir: string): Promise<TrustProfile> {
  try {
    const raw = await readFile(file(dataDir), 'utf8');
    const parsed = JSON.parse(raw) as Partial<TrustProfile>;
    const base = emptyProfile(Date.now());
    return {
      ...base,
      ...parsed,
      frameworks: Array.isArray(parsed.frameworks) ? parsed.frameworks : [],
      links: Array.isArray(parsed.links) ? parsed.links : [],
    } as TrustProfile;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return emptyProfile(Date.now());
    }
    throw err;
  }
}

async function writeProfile(dataDir: string, profile: TrustProfile): Promise<void> {
  const target = file(dataDir);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(profile, null, 2) + '\n', 'utf8');
}

/**
 * Load the current trust profile, materialising an empty one on a
 * fresh install so callers always get a coherent shape.
 */
export async function getProfile(dataDir: string): Promise<TrustProfile> {
  return readProfile(dataDir);
}

/**
 * Validate the input and persist a new profile. Returns the stored
 * value (after normalisation) so the caller can write the audit row
 * with the canonical shape.
 */
export async function updateProfile(
  dataDir: string,
  actor: string,
  input: TrustProfileInput,
): Promise<TrustProfile> {
  const current = await readProfile(dataDir);
  const next = validateAndMerge(current, input);
  next.updatedAt = Date.now();
  next.updatedBy = actor;
  await writeProfile(dataDir, next);
  return next;
}

export function validateAndMerge(
  current: TrustProfile,
  input: TrustProfileInput,
): TrustProfile {
  const out: TrustProfile = { ...current };

  if (input.summary !== undefined) {
    if (typeof input.summary !== 'string') fail('summary must be a string');
    if (input.summary.length > TRUST_LIMITS.summary) fail('summary too long');
    out.summary = input.summary;
  }

  if (input.securityContactEmail !== undefined) {
    out.securityContactEmail = checkEmail('securityContactEmail', input.securityContactEmail);
  }

  if (input.vulnerabilityPolicyUrl !== undefined) {
    out.vulnerabilityPolicyUrl = checkUrl('vulnerabilityPolicyUrl', input.vulnerabilityPolicyUrl);
  }

  if (input.encryptionAtRest !== undefined) {
    if (input.encryptionAtRest != null && input.encryptionAtRest.length > TRUST_LIMITS.encryptionField) {
      fail('encryptionAtRest too long');
    }
    out.encryptionAtRest = input.encryptionAtRest ?? null;
  }
  if (input.encryptionInTransit !== undefined) {
    if (input.encryptionInTransit != null && input.encryptionInTransit.length > TRUST_LIMITS.encryptionField) {
      fail('encryptionInTransit too long');
    }
    out.encryptionInTransit = input.encryptionInTransit ?? null;
  }
  if (input.dataResidency !== undefined) {
    if (input.dataResidency != null && input.dataResidency.length > TRUST_LIMITS.residency) {
      fail('dataResidency too long');
    }
    out.dataResidency = input.dataResidency ?? null;
  }

  if (input.frameworks !== undefined) {
    if (!Array.isArray(input.frameworks)) fail('frameworks must be an array');
    if (input.frameworks.length > TRUST_LIMITS.maxFrameworks) fail('too many frameworks');
    out.frameworks = input.frameworks.map((f, i) => {
      if (!f || typeof f !== 'object') fail(`framework[${i}] invalid`);
      if (!f.name || typeof f.name !== 'string') fail(`framework[${i}].name required`);
      if (f.name.length > TRUST_LIMITS.frameworkName) fail(`framework[${i}].name too long`);
      if (!['in_progress', 'achieved', 'not_pursued'].includes(f.status)) {
        fail(`framework[${i}].status invalid`);
      }
      if (f.auditor != null && (typeof f.auditor !== 'string' || f.auditor.length > TRUST_LIMITS.auditor)) {
        fail(`framework[${i}].auditor invalid`);
      }
      const issuedAt = f.issuedAt != null && f.issuedAt !== '' ? f.issuedAt : null;
      if (issuedAt != null) {
        if (typeof issuedAt !== 'string' || Number.isNaN(Date.parse(issuedAt))) {
          fail(`framework[${i}].issuedAt must be ISO date`);
        }
      }
      return {
        name: f.name.trim(),
        status: f.status,
        issuedAt,
        auditor: f.auditor ? f.auditor.trim() : null,
        reportUrl: checkUrl(`framework[${i}].reportUrl`, f.reportUrl),
      };
    });
  }

  if (input.links !== undefined) {
    if (!Array.isArray(input.links)) fail('links must be an array');
    if (input.links.length > TRUST_LIMITS.maxLinks) fail('too many links');
    out.links = input.links.map((l, i) => {
      if (!l || typeof l !== 'object') fail(`link[${i}] invalid`);
      if (!l.label || typeof l.label !== 'string') fail(`link[${i}].label required`);
      if (l.label.length > TRUST_LIMITS.linkLabel) fail(`link[${i}].label too long`);
      const url = checkUrl(`link[${i}].url`, l.url);
      if (!url) fail(`link[${i}].url required`);
      return { label: l.label.trim(), url };
    });
  }

  return out;
}

/**
 * Public projection of the profile suitable for an unauthenticated
 * endpoint. Strips operator-only fields (updatedBy) that should not
 * leak from an internet-exposed instance, and stamps a generatedAt
 * so consumers can cache without confusion.
 */
export function publicView(profile: TrustProfile): Record<string, unknown> {
  return {
    summary: profile.summary,
    securityContactEmail: profile.securityContactEmail,
    vulnerabilityPolicyUrl: profile.vulnerabilityPolicyUrl,
    frameworks: profile.frameworks,
    encryptionAtRest: profile.encryptionAtRest,
    encryptionInTransit: profile.encryptionInTransit,
    dataResidency: profile.dataResidency,
    links: profile.links,
    updatedAt: profile.updatedAt,
    generatedAt: Date.now(),
  };
}

/**
 * Render an RFC 9116 security.txt body from the profile. Returns null
 * when there is no usable contact, so the route can 404 instead of
 * serving a malformed file (security.txt with no Contact: field is
 * worse than no file at all because scanners flag it as broken).
 */
export function renderSecurityTxt(profile: TrustProfile): string | null {
  const contacts: string[] = [];
  if (profile.securityContactEmail) {
    contacts.push(`Contact: mailto:${profile.securityContactEmail}`);
  }
  if (profile.vulnerabilityPolicyUrl) {
    contacts.push(`Contact: ${profile.vulnerabilityPolicyUrl}`);
  }
  if (contacts.length === 0) return null;

  // RFC 9116 requires Expires; 1 year from the last edit is the
  // common operational choice. Operators who want a longer window
  // can re-save the profile to roll it forward.
  const expires = new Date(profile.updatedAt + 365 * 24 * 60 * 60 * 1000).toISOString();
  const lines = [
    ...contacts,
    `Expires: ${expires}`,
    'Preferred-Languages: en',
  ];
  if (profile.vulnerabilityPolicyUrl) {
    lines.push(`Policy: ${profile.vulnerabilityPolicyUrl}`);
  }
  return lines.join('\n') + '\n';
}
