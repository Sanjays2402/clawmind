import assert from 'node:assert/strict';
import {
  parseRecent,
  pushRecent,
  bestRouteHref,
  RECENT_MAX,
} from '../../apps/web/src/lib/recentPages.ts';

let n = 0;
function ok(label: string, cond: boolean) {
  n++;
  assert.ok(cond, label);
}
function eq<T>(label: string, a: T, b: T) {
  n++;
  assert.deepEqual(a, b, label);
}

// --- parseRecent ---
eq('null -> []', parseRecent(null), []);
eq('empty string -> []', parseRecent(''), []);
eq('garbage -> []', parseRecent('{not json'), []);
eq('object (not array) -> []', parseRecent('{"a":1}'), []);
eq('array of strings kept', parseRecent('["/a","/b"]'), ['/a', '/b']);
eq('non-strings dropped', parseRecent('["/a",1,null,true,"/b"]'), ['/a', '/b']);
eq('empty strings dropped', parseRecent('["/a","","/b"]'), ['/a', '/b']);
ok('caps at RECENT_MAX', parseRecent(JSON.stringify(Array.from({ length: 50 }, (_, i) => `/p${i}`))).length === RECENT_MAX);

// --- pushRecent ---
eq('push onto empty', pushRecent('/a', []), ['/a']);
eq('push prepends', pushRecent('/b', ['/a']), ['/b', '/a']);
eq('re-push moves to front (no dup)', pushRecent('/a', ['/b', '/a', '/c']), ['/a', '/b', '/c']);
eq('empty path is a no-op', pushRecent('', ['/a', '/b']), ['/a', '/b']);
eq('cap respected', pushRecent('/new', ['/a', '/b', '/c'], 3), ['/new', '/a', '/b']);
eq('cap 0 -> empty', pushRecent('/x', ['/a'], 0), []);

// Re-push that already sits at the front is idempotent on order + length.
eq('re-push head is stable', pushRecent('/a', ['/a', '/b']), ['/a', '/b']);

// Immutability: the input list is never mutated.
const input = ['/a', '/b'];
const before = [...input];
pushRecent('/c', input);
eq('input not mutated', input, before);

// A realistic settings-heavy sequence collapses correctly under repeated visits.
let list: string[] = [];
for (const p of ['/chat', '/settings/security', '/chat', '/stats', '/settings/security']) {
  list = pushRecent(p, list);
}
eq('sequence yields most-recent-first, deduped', list, ['/settings/security', '/stats', '/chat']);

// --- bestRouteHref ---
const HREFS = ['/chat', '/settings', '/sources', '/stats', '/conversations'];
eq('exact match', bestRouteHref('/chat', HREFS), '/chat');
eq('sub-page collapses to owner', bestRouteHref('/settings/security', HREFS), '/settings');
eq('deep sub-page collapses to owner', bestRouteHref('/settings/api-key-policy', HREFS), '/settings');
eq('detail page collapses', bestRouteHref('/sources/view', HREFS), '/sources');
eq('query stripped', bestRouteHref('/chat?q=hello', HREFS), '/chat');
eq('hash stripped', bestRouteHref('/stats#top', HREFS), '/stats');
eq('trailing slash tolerated', bestRouteHref('/sources/', HREFS), '/sources');
eq('unknown path -> null', bestRouteHref('/nope', HREFS), null);
eq('most-specific href wins', bestRouteHref('/sources/view', ['/', '/sources']), '/sources');
ok('prefix is path-segment bounded', bestRouteHref('/sourcesX', HREFS) === null);

console.log(`recentPages: ${n} assertions passed`);
