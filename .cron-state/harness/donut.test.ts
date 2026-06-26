import assert from 'node:assert/strict';
import {
  polarToXy,
  ringArcPath,
  donutSegments,
  fmtShare,
} from '../../apps/web/src/lib/donut.ts';

let n = 0;
function ok(label: string, cond: boolean) {
  n++;
  assert.ok(cond, label);
}
function close(label: string, a: number, b: number, eps = 1e-6) {
  n++;
  assert.ok(Math.abs(a - b) < eps, `${label}: ${a} !~ ${b}`);
}
function eq<T>(label: string, a: T, b: T) {
  n++;
  assert.deepEqual(a, b, label);
}

// --- polarToXy: 0deg is 12 o'clock, sweeps clockwise ---
const top = polarToXy(0, 0, 10, 0);
close('0deg x', top.x, 0);
close('0deg y (up = -y)', top.y, -10);
const right = polarToXy(0, 0, 10, 90);
close('90deg x (right)', right.x, 10);
close('90deg y', right.y, 0);
const bottom = polarToXy(0, 0, 10, 180);
close('180deg y (down)', bottom.y, 10);

// --- ringArcPath ---
ok('zero sweep -> empty', ringArcPath(50, 50, 40, 24, 30, 30) === '');
ok('negative sweep -> empty', ringArcPath(50, 50, 40, 24, 90, 30) === '');
const quarter = ringArcPath(50, 50, 40, 24, 0, 90);
ok('arc starts with moveto', quarter.startsWith('M '));
ok('arc has two A commands', (quarter.match(/A /g) ?? []).length === 2);
ok('arc closes', quarter.trim().endsWith('Z'));
ok('<=180 uses largeArc 0', quarter.includes(' 0 1 '));
const bigArc = ringArcPath(50, 50, 40, 24, 0, 270);
ok('>180 uses largeArc 1', bigArc.includes(' 1 1 '));
const full = ringArcPath(50, 50, 40, 24, 0, 360);
ok('full ring splits into two arcs (4 A commands)', (full.match(/A /g) ?? []).length === 4);

// --- donutSegments ---
const opts = { cx: 50, cy: 50, rOuter: 40, rInner: 24 };
eq('empty data -> []', donutSegments([], opts), []);
eq('all-zero -> []', donutSegments([{ key: 'a', value: 0 }, { key: 'b', value: 0 }], opts), []);

const segs = donutSegments(
  [
    { key: 'a', value: 50 },
    { key: 'b', value: 30 },
    { key: 'c', value: 20 },
  ],
  opts,
);
eq('three segments', segs.length, 3);
close('fractions sum to 1', segs.reduce((s, x) => s + x.fraction, 0), 1);
close('a is half', segs[0]!.fraction, 0.5);
close('first starts at 0deg', segs[0]!.startAngle, 0);
close('segments are contiguous', segs[0]!.endAngle, segs[1]!.startAngle);
close('last ends at 360deg', segs[2]!.endAngle, 360);
ok('every segment has a path', segs.every((s) => s.path.length > 0));

// Negative / NaN values are dropped, the rest still normalize to 1.
const mixed = donutSegments(
  [
    { key: 'a', value: 10 },
    { key: 'bad', value: -5 },
    { key: 'nan', value: Number.NaN },
    { key: 'b', value: 10 },
  ],
  opts,
);
eq('negatives + NaN dropped', mixed.length, 2);
close('survivors split evenly', mixed[0]!.fraction, 0.5);

// A single namespace fills the whole ring.
const one = donutSegments([{ key: 'solo', value: 7 }], opts);
eq('single segment', one.length, 1);
close('single fills the ring', one[0]!.fraction, 1);
ok('full-ring path has 4 arcs', (one[0]!.path.match(/A /g) ?? []).length === 4);

// --- fmtShare ---
eq('0 -> 0%', fmtShare(0), '0%');
eq('half -> 50%', fmtShare(0.5), '50%');
eq('round to nearest', fmtShare(0.333), '33%');
eq('tiny but present -> <1%', fmtShare(0.004), '<1%');
eq('exactly 1 -> 100%', fmtShare(1), '100%');

console.log(`donut: ${n} assertions passed`);
