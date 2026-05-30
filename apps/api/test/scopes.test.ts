import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { KNOWN_SCOPES, Scopes, isKnownScope } from '../src/scopes.js';
import { SCOPE_RE, WILDCARD_SCOPE } from '../src/services/api-keys.js';

// These tests guard the contract that every mutating or sensitive route
// declares an enforceable scope. The previous state of the world was that
// only two routes (/v1/search and /v1/ingest) called requireScope, which
// meant a scoped API key was effectively a key with `*` for everything else.
// We now require every route file to wire scopes alongside requireAuth /
// requireRole so the documented permission model matches what the server
// actually enforces.

const here = dirname(fileURLToPath(import.meta.url));
const routesDir = resolve(here, '..', 'src', 'routes');

function readRoute(name: string): string {
  return readFileSync(join(routesDir, name), 'utf8');
}

const ROUTE_FILES = readdirSync(routesDir)
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts');

// Health and the public share-read endpoint do not require auth, so they
// also do not declare scopes. Everything else must.
const UNGATED_ROUTE_FILES = new Set(['health.ts']);

describe('scope registry', () => {
  it('every Scopes.* value matches the wildcard or resource:action grammar', () => {
    for (const s of Object.values(Scopes)) {
      expect(s === WILDCARD_SCOPE || SCOPE_RE.test(s), `bad scope ${s}`).toBe(true);
    }
  });

  it('KNOWN_SCOPES matches Object.values(Scopes) and has no duplicates', () => {
    const direct = Object.values(Scopes);
    expect([...KNOWN_SCOPES].sort()).toEqual([...direct].sort());
    expect(new Set(KNOWN_SCOPES).size).toBe(KNOWN_SCOPES.length);
  });

  it('isKnownScope agrees with the registry', () => {
    expect(isKnownScope('search:read')).toBe(true);
    expect(isKnownScope('not-a-scope')).toBe(false);
  });
});

describe('per-route scope enforcement', () => {
  it('every gated route file imports Scopes from ../scopes.js', () => {
    for (const f of ROUTE_FILES) {
      if (UNGATED_ROUTE_FILES.has(f)) continue;
      const src = readRoute(f);
      expect(src, `${f} must import Scopes`).toMatch(/from ['"]\.\.\/scopes\.js['"]/);
    }
  });

  it('no gated route file leaves preHandler as a bare requireAuth / requireRole call', () => {
    for (const f of ROUTE_FILES) {
      if (UNGATED_ROUTE_FILES.has(f)) continue;
      const src = readRoute(f);
      // Bare `preHandler: app.requireAuth,` (no array, no scope) would mean
      // that endpoint cannot be restricted by API-key scopes.
      expect(src, `${f} has unscoped preHandler: app.requireAuth`)
        .not.toMatch(/preHandler:\s*app\.requireAuth,/);
      expect(src, `${f} has unscoped preHandler: app.requireRole(...)`)
        .not.toMatch(/preHandler:\s*app\.requireRole\([^)]+\),/);
    }
  });

  it('every gated route file references at least one requireScope() call', () => {
    for (const f of ROUTE_FILES) {
      if (UNGATED_ROUTE_FILES.has(f)) continue;
      const src = readRoute(f);
      expect(src, `${f} must call app.requireScope`).toMatch(/app\.requireScope\(/);
    }
  });

  it('every requireScope() argument resolves to a known scope', () => {
    // Match both Scopes.X references and bare string literals.
    const known = new Set<string>(KNOWN_SCOPES as readonly string[]);
    const re = /app\.requireScope\(\s*(?:Scopes\.([A-Za-z]+)|['"]([^'"]+)['"])\s*\)/g;
    for (const f of ROUTE_FILES) {
      if (UNGATED_ROUTE_FILES.has(f)) continue;
      const src = readRoute(f);
      for (const m of src.matchAll(re)) {
        if (m[1]) {
          expect(
            Object.prototype.hasOwnProperty.call(Scopes, m[1]),
            `${f}: Scopes.${m[1]} is not in the registry`,
          ).toBe(true);
        } else if (m[2]) {
          expect(known.has(m[2]), `${f}: bare scope "${m[2]}" not in registry`).toBe(true);
        }
      }
    }
  });
});
