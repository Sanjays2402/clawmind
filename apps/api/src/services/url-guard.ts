import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

// SSRF guard for any URL we are about to POST to from the server (outbound
// webhooks today, anything else tomorrow). The threat: a tenant with
// webhooks:manage registers https://attacker.example then later flips the
// DNS to 169.254.169.254 (EC2 IMDS), 127.0.0.1 (sidecar admin), or an
// RFC1918 IP inside our VPC. Our HMAC-signed POST would then carry our
// service-account creds into the metadata endpoint and the reply (with
// IAM tokens) would land in the delivery log.
//
// Defence in depth:
//  1. Scheme allowlist (http/https only).
//  2. Port allowlist (no 22, 25, 6379, 11211, etc.).
//  3. Reject userinfo (creds in URL).
//  4. Resolve the hostname NOW (re-checked on every delivery attempt, which
//     defeats time-of-check / time-of-use DNS rebinding) and reject if any
//     A/AAAA record points at a private / loopback / link-local / reserved
//     range.
//
// Bypass for dev/test: CLAWMIND_WEBHOOK_ALLOW_PRIVATE=true. Production must
// leave this off; the API audit-logs every rejection so an operator can
// see when a tenant tried to point at something internal.

export interface UrlGuardOptions {
  allowPrivate?: boolean;
  allowedPorts?: number[];
  // Extra hostnames or IPs to deny even when allowPrivate=true (typically
  // your cloud provider's metadata endpoint).
  extraDenyHosts?: string[];
}

export class UnsafeUrlError extends Error {
  constructor(message: string, public readonly reason: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

const DEFAULT_ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

// Always reject these no matter what allowPrivate says. AWS / GCP / Azure /
// Oracle / Alibaba metadata endpoints all answer on 169.254.169.254 and
// GCP additionally on metadata.google.internal.
const ALWAYS_DENY_HOSTS = new Set([
  '169.254.169.254',
  'metadata.google.internal',
  'metadata',
]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map((n) => Number(n));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // malformed: treat as unsafe
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;                                  // 10.0.0.0/8
  if (a === 127) return true;                                 // loopback
  if (a === 0) return true;                                   // 0.0.0.0/8
  if (a === 169 && b === 254) return true;                    // link-local
  if (a === 172 && b >= 16 && b <= 31) return true;           // 172.16.0.0/12
  if (a === 192 && b === 168) return true;                    // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT 100.64/10
  if (a >= 224) return true;                                  // multicast + reserved
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lc = ip.toLowerCase();
  if (lc === '::1' || lc === '::') return true;
  if (lc.startsWith('fc') || lc.startsWith('fd')) return true; // unique local fc00::/7
  if (lc.startsWith('fe80')) return true;                       // link-local
  if (lc.startsWith('ff')) return true;                         // multicast
  if (lc.startsWith('::ffff:')) {
    // IPv4-mapped IPv6: re-check as IPv4.
    return isPrivateIPv4(lc.slice('::ffff:'.length));
  }
  return false;
}

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true; // not an IP at all -> caller should not have passed it
}

/**
 * Parse and validate a URL string. Throws UnsafeUrlError on any problem.
 * Does NOT resolve DNS - use assertPublicUrl() for that.
 */
export function parseSafeUrl(input: string, opts: UrlGuardOptions = {}): URL {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new UnsafeUrlError('invalid url', 'parse');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new UnsafeUrlError(`unsupported scheme: ${u.protocol}`, 'scheme');
  }
  if (u.username || u.password) {
    throw new UnsafeUrlError('credentials in url are not allowed', 'userinfo');
  }
  const allowedPorts = new Set(opts.allowedPorts ?? Array.from(DEFAULT_ALLOWED_PORTS));
  // If port omitted, browsers default by scheme; we accept the implicit one.
  if (u.port) {
    const p = Number(u.port);
    if (!allowedPorts.has(p)) {
      throw new UnsafeUrlError(`port ${p} not allowed`, 'port');
    }
  }
  const host = u.hostname.toLowerCase();
  const denied = new Set([...ALWAYS_DENY_HOSTS, ...(opts.extraDenyHosts ?? []).map((h) => h.toLowerCase())]);
  if (denied.has(host)) {
    throw new UnsafeUrlError(`host ${host} is denied`, 'deny-list');
  }
  return u;
}

/**
 * Full check: validates the URL shape AND resolves the host, rejecting any
 * answer that points at a private / reserved address. Call this both at
 * registration time and immediately before every outbound request, so a
 * tenant who flips DNS after registration cannot bypass the check.
 */
export async function assertPublicUrl(input: string, opts: UrlGuardOptions = {}): Promise<URL> {
  const u = parseSafeUrl(input, opts);
  if (opts.allowPrivate) {
    // Still enforce the always-deny list (metadata endpoints).
    return u;
  }
  const host = u.hostname;
  // If the hostname is already a literal IP, check it directly.
  if (isIP(host)) {
    if (isPrivateIp(host)) {
      throw new UnsafeUrlError(`host ${host} resolves to a private address`, 'private-ip');
    }
    return u;
  }
  let answers: { address: string; family: number }[];
  try {
    answers = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(`cannot resolve host: ${host}`, 'dns');
  }
  if (answers.length === 0) {
    throw new UnsafeUrlError(`no DNS records for ${host}`, 'dns');
  }
  for (const a of answers) {
    if (isPrivateIp(a.address)) {
      throw new UnsafeUrlError(
        `host ${host} resolves to private address ${a.address}`,
        'private-ip',
      );
    }
  }
  return u;
}
