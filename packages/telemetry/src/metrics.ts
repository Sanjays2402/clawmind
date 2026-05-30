// Tiny dependency-free metrics registry with Prometheus text exposition.
//
// We do not pull in prom-client because the API surface we need is small and
// we want zero added install weight on the embed sidecar and tests. The
// exposition format implemented here is the Prometheus 0.0.4 text format
// (https://github.com/prometheus/docs/blob/main/content/docs/instrumenting/exposition_formats.md).

type Labels = Record<string, string>;

type CounterSeries = { value: number; labels: Labels };
type HistogramSeries = {
  labels: Labels;
  count: number;
  sum: number;
  min: number;
  max: number;
  buckets: number[]; // upper bounds, sorted asc, +Inf implicit
  bucketCounts: number[]; // cumulative counts aligned with `buckets` + 1 for +Inf
};

type CounterMeta = { name: string; help: string; series: Map<string, CounterSeries> };
type HistogramMeta = {
  name: string;
  help: string;
  buckets: number[];
  series: Map<string, HistogramSeries>;
};

const counters = new Map<string, CounterMeta>();
const histograms = new Map<string, HistogramMeta>();

// Default buckets in seconds, tuned for HTTP API latencies on a local box plus
// occasional slow LLM-bound routes. Override per metric via `defineHistogram`.
const DEFAULT_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

function labelKey(labels: Labels): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${labels[k]}`).join(',');
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

function formatLabels(labels: Labels, extra?: Labels): string {
  const merged = { ...labels, ...(extra ?? {}) };
  const keys = Object.keys(merged).sort();
  if (keys.length === 0) return '';
  const parts = keys.map((k) => `${k}="${escapeLabelValue(String(merged[k]))}"`);
  return `{${parts.join(',')}}`;
}

function getCounterMeta(name: string, help = ''): CounterMeta {
  let meta = counters.get(name);
  if (!meta) {
    meta = { name, help: help || name, series: new Map() };
    counters.set(name, meta);
  } else if (help && !meta.help) {
    meta.help = help;
  }
  return meta;
}

function getHistogramMeta(name: string, help = '', buckets?: number[]): HistogramMeta {
  let meta = histograms.get(name);
  if (!meta) {
    meta = {
      name,
      help: help || name,
      buckets: (buckets ?? DEFAULT_BUCKETS_SECONDS).slice().sort((a, b) => a - b),
      series: new Map(),
    };
    histograms.set(name, meta);
  } else if (help && !meta.help) {
    meta.help = help;
  }
  return meta;
}

export function defineCounter(name: string, help: string): void {
  getCounterMeta(name, help);
}

export function defineHistogram(name: string, help: string, buckets?: number[]): void {
  getHistogramMeta(name, help, buckets);
}

export function incr(name: string, by = 1, labels: Labels = {}): void {
  const meta = getCounterMeta(name);
  const key = labelKey(labels);
  const series = meta.series.get(key) ?? { value: 0, labels };
  series.value += by;
  meta.series.set(key, series);
}

export function observe(name: string, value: number, labels: Labels = {}): void {
  const meta = getHistogramMeta(name);
  const key = labelKey(labels);
  let series = meta.series.get(key);
  if (!series) {
    series = {
      labels,
      count: 0,
      sum: 0,
      min: Infinity,
      max: -Infinity,
      buckets: meta.buckets,
      bucketCounts: new Array(meta.buckets.length + 1).fill(0),
    };
    meta.series.set(key, series);
  }
  series.count += 1;
  series.sum += value;
  series.min = Math.min(series.min, value);
  series.max = Math.max(series.max, value);
  for (let i = 0; i < meta.buckets.length; i++) {
    if (value <= meta.buckets[i]!) series.bucketCounts[i]! += 1;
  }
  series.bucketCounts[meta.buckets.length]! += 1; // +Inf
}

// JSON snapshot retained for back-compat (debug UIs, existing tests).
export function snapshot() {
  const counterOut: Record<string, number | Record<string, number>> = {};
  for (const meta of counters.values()) {
    if (meta.series.size === 1 && labelKey([...meta.series.values()][0]!.labels) === '') {
      counterOut[meta.name] = [...meta.series.values()][0]!.value;
    } else {
      const sub: Record<string, number> = {};
      for (const s of meta.series.values()) sub[labelKey(s.labels) || '_'] = s.value;
      counterOut[meta.name] = sub;
    }
  }
  const histOut: Record<string, unknown> = {};
  for (const meta of histograms.values()) {
    const sub: Record<string, unknown> = {};
    for (const s of meta.series.values()) {
      sub[labelKey(s.labels) || '_'] = {
        count: s.count,
        sum: s.sum,
        min: s.count ? s.min : 0,
        max: s.count ? s.max : 0,
        avg: s.count ? s.sum / s.count : 0,
      };
    }
    histOut[meta.name] = sub;
  }
  return { counters: counterOut, histograms: histOut };
}

export const PROM_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export function renderProm(): string {
  const lines: string[] = [];

  for (const meta of counters.values()) {
    lines.push(`# HELP ${meta.name} ${meta.help}`);
    lines.push(`# TYPE ${meta.name} counter`);
    if (meta.series.size === 0) {
      lines.push(`${meta.name} 0`);
    } else {
      for (const s of meta.series.values()) {
        lines.push(`${meta.name}${formatLabels(s.labels)} ${s.value}`);
      }
    }
  }

  for (const meta of histograms.values()) {
    lines.push(`# HELP ${meta.name} ${meta.help}`);
    lines.push(`# TYPE ${meta.name} histogram`);
    for (const s of meta.series.values()) {
      for (let i = 0; i < meta.buckets.length; i++) {
        lines.push(
          `${meta.name}_bucket${formatLabels(s.labels, { le: String(meta.buckets[i]) })} ${s.bucketCounts[i]}`,
        );
      }
      lines.push(
        `${meta.name}_bucket${formatLabels(s.labels, { le: '+Inf' })} ${s.bucketCounts[meta.buckets.length]}`,
      );
      lines.push(`${meta.name}_sum${formatLabels(s.labels)} ${s.sum}`);
      lines.push(`${meta.name}_count${formatLabels(s.labels)} ${s.count}`);
    }
  }

  // Process info: cheap, no extra deps.
  const mem = process.memoryUsage();
  lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
  lines.push('# TYPE process_resident_memory_bytes gauge');
  lines.push(`process_resident_memory_bytes ${mem.rss}`);
  lines.push('# HELP nodejs_heap_used_bytes Process heap memory used in bytes.');
  lines.push('# TYPE nodejs_heap_used_bytes gauge');
  lines.push(`nodejs_heap_used_bytes ${mem.heapUsed}`);
  lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${process.uptime()}`);

  return lines.join('\n') + '\n';
}

export function reset() {
  counters.clear();
  histograms.clear();
}
