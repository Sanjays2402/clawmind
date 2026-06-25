/**
 * Per-route document title resolution.
 *
 * Every client-rendered page in the app currently inherits the static
 * `title: 'ClawMind'` from the root layout, so the browser tab, history and
 * bookmarks read the same on every page. This module maps a pathname to a
 * human label and is consumed by the <DocumentTitle> client component mounted
 * in the layout.
 *
 * Routes that ship their OWN server `generateMetadata` (trust, incidents,
 * sbom, breach-register, offline, the public /s/[id] share page) are returned
 * as `null` here so the client setter never clobbers their server-set titles.
 */

const SUFFIX = 'ClawMind';

// Routes whose <title> is owned by a server `generateMetadata` / `metadata`
// export. The client setter must leave these alone.
const SERVER_TITLED = new Set<string>([
  '/trust',
  '/incidents',
  '/sbom',
  '/breach-register',
  '/offline',
]);

// Top-level route labels. Anything not listed falls back to a humanized
// segment (e.g. "/foo-bar" -> "Foo bar").
const TOP_LEVEL: Record<string, string> = {
  '': 'Home',
  about: 'About',
  admin: 'Admin',
  aliases: 'Aliases',
  audit: 'Audit log',
  batch: 'Batch',
  chat: 'Ask',
  collections: 'Collections',
  conversations: 'Threads',
  dashboard: 'Dashboard',
  demo: 'Demo',
  digests: 'Digests',
  doctor: 'Doctor',
  explain: 'Explain',
  feedback: 'Feedback',
  history: 'History',
  ingest: 'Ingest',
  keys: 'API keys',
  mutes: 'Mutes',
  notifications: 'Inbox',
  pins: 'Pins',
  posture: 'Posture',
  related: 'Related',
  saved: 'Saved searches',
  search: 'Search',
  settings: 'Settings',
  shares: 'Shares',
  sources: 'Sources',
  stale: 'Stale',
  stats: 'Stats',
  tags: 'Tags',
  usage: 'Usage',
  webhooks: 'Webhooks',
  welcome: 'Welcome',
};

// Settings sub-page labels. The settings tree is deep and the bare humanized
// segment ("Pii redaction", "Sso") reads poorly, so the high-traffic / acronym
// pages get curated labels; the rest humanize cleanly.
const SETTINGS: Record<string, string> = {
  '': 'Settings',
  'acceptable-use': 'Acceptable use',
  'access-reviews': 'Access reviews',
  'api-key-bruteforce': 'API key brute-force',
  'api-key-expiry': 'API key expiry',
  'api-key-inactivity': 'API key inactivity',
  'api-key-policy': 'API key policy',
  'audit-proofs': 'Audit proofs',
  classification: 'Data classification',
  'data-residency': 'Data residency',
  domains: 'Domains',
  dpa: 'DPA',
  dsr: 'Data subject requests',
  encryption: 'Encryption',
  'erasure-certificates': 'Erasure certificates',
  honeytokens: 'Honeytokens',
  incidents: 'Incidents',
  invitations: 'Invitations',
  'key-activation': 'Key activation',
  'legal-hold': 'Legal hold',
  'login-banner': 'Login banner',
  maintenance: 'Maintenance',
  members: 'Members',
  mfa: 'MFA',
  'mfa-policy': 'MFA policy',
  'model-allowlist': 'Model allowlist',
  notifications: 'Notifications',
  offboarding: 'Offboarding',
  'pii-redaction': 'PII redaction',
  policies: 'Policies',
  'query-blocklist': 'Query blocklist',
  quota: 'Quota',
  'recovery-contacts': 'Recovery contacts',
  retention: 'Retention',
  'role-elevation': 'Role elevation',
  ropa: 'RoPA',
  scim: 'SCIM',
  security: 'Security',
  'session-policy': 'Session policy',
  sessions: 'Sessions',
  'share-policy': 'Share policy',
  'sign-in-anomalies': 'Sign-in anomalies',
  'sign-in-geofence': 'Sign-in geofence',
  'sign-in-log': 'Sign-in log',
  sso: 'SSO',
  'sub-processors': 'Sub-processors',
  trust: 'Trust',
  'vendor-access': 'Vendor access',
  'warrant-canary': 'Warrant canary',
  'webhook-allowlist': 'Webhook allowlist',
  'webhook-events-allowlist': 'Webhook events allowlist',
  whoami: 'Who am I',
  'workspace-deletion': 'Workspace deletion',
  'workspace-export': 'Workspace export',
  'workspace-freeze': 'Workspace freeze',
  'workspace-ip-allowlist': 'Workspace IP allowlist',
  'workspace-origin-allowlist': 'Workspace origin allowlist',
};

/** Title-case a kebab/space segment: "foo-bar" -> "Foo bar". */
export function humanize(segment: string): string {
  const s = segment.replace(/[-_]+/g, ' ').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Human label for a single settings sub-page segment, reusing the curated
 * SETTINGS map (so acronym pages like "sso" / "dpa" read correctly) and
 * falling back to a humanized segment. Shared by the document-title resolver
 * and the settings breadcrumb bar so the two never drift.
 */
export function settingsSubLabel(sub: string): string {
  return SETTINGS[sub] ?? humanize(sub);
}

/**
 * Resolve the human label for a pathname, or `null` when the route owns its
 * own server-set title and the client setter must not touch it.
 */
export function pageLabel(pathname: string | null | undefined): string | null {
  if (!pathname) return null;
  // Strip query/hash and trailing slash, then split into segments.
  const clean = pathname.split(/[?#]/)[0]!.replace(/\/+$/, '');
  if (SERVER_TITLED.has(clean)) return null;

  const segments = clean.split('/').filter(Boolean);

  // Root.
  if (segments.length === 0) return TOP_LEVEL[''] ?? SUFFIX;

  // Settings subtree gets its own label table + breadcrumb-style title.
  if (segments[0] === 'settings') {
    if (segments.length === 1) return SETTINGS[''] ?? 'Settings';
    const sub = segments[1]!;
    if (SERVER_TITLED.has(`/settings/${sub}`)) return null;
    const label = SETTINGS[sub] ?? humanize(sub);
    return `${label} · Settings`;
  }

  const top = segments[0]!;
  const base = TOP_LEVEL[top] ?? humanize(top);
  // A second segment (detail page) gets appended when it isn't an opaque id.
  const detail = segments[1];
  if (detail !== undefined && !isOpaqueId(detail)) {
    return `${humanize(detail)} · ${base}`;
  }
  return base;
}

/** Opaque ids (hashes, uuids, numeric) shouldn't be humanized into a title. */
function isOpaqueId(segment: string): boolean {
  return /^[0-9a-f]{8,}$/i.test(segment) || /^\d+$/.test(segment) || segment.length > 24;
}

/**
 * Full document title for a pathname: "<Label> · ClawMind", or just the
 * suffix on the home page, or `null` when the route is server-titled.
 */
export function pageTitle(pathname: string | null | undefined): string | null {
  const label = pageLabel(pathname);
  if (label === null) return null;
  if (label === TOP_LEVEL['']) return SUFFIX; // Home -> bare brand.
  return `${label} · ${SUFFIX}`;
}
