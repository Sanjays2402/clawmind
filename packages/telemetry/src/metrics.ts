type Counter = { value: number };
type Histogram = { count: number; sum: number; min: number; max: number };

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

export function incr(name: string, by = 1) {
  const c = counters.get(name) ?? { value: 0 };
  c.value += by;
  counters.set(name, c);
}

export function observe(name: string, value: number) {
  const h = histograms.get(name) ?? { count: 0, sum: 0, min: Infinity, max: -Infinity };
  h.count += 1;
  h.sum += value;
  h.min = Math.min(h.min, value);
  h.max = Math.max(h.max, value);
  histograms.set(name, h);
}

export function snapshot() {
  return {
    counters: Object.fromEntries([...counters].map(([k, v]) => [k, v.value])),
    histograms: Object.fromEntries(
      [...histograms].map(([k, h]) => [k, { ...h, avg: h.count ? h.sum / h.count : 0 }]),
    ),
  };
}

export function reset() {
  counters.clear();
  histograms.clear();
}
