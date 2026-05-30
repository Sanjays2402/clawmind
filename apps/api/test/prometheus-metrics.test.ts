import { describe, it, expect, beforeEach } from 'vitest';
import {
  reset,
  incr,
  observe,
  defineCounter,
  defineHistogram,
  renderProm,
  snapshot,
  PROM_CONTENT_TYPE,
} from '@clawmind/telemetry';

describe('prometheus metrics exposition', () => {
  beforeEach(() => reset());

  it('declares the standard content type', () => {
    expect(PROM_CONTENT_TYPE).toMatch(/text\/plain/);
    expect(PROM_CONTENT_TYPE).toMatch(/version=0\.0\.4/);
  });

  it('renders counters with HELP, TYPE, and labels', () => {
    defineCounter('http_requests_total', 'Total HTTP requests handled by the API.');
    incr('http_requests_total', 1, { method: 'GET', route: '/v1/ask', status: '200' });
    incr('http_requests_total', 2, { method: 'GET', route: '/v1/ask', status: '200' });
    incr('http_requests_total', 1, { method: 'POST', route: '/v1/ask', status: '500' });

    const out = renderProm();
    expect(out).toContain('# HELP http_requests_total Total HTTP requests handled by the API.');
    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toMatch(
      /http_requests_total\{method="GET",route="\/v1\/ask",status="200"\} 3/,
    );
    expect(out).toMatch(
      /http_requests_total\{method="POST",route="\/v1\/ask",status="500"\} 1/,
    );
  });

  it('renders histograms with cumulative buckets, sum, and count', () => {
    defineHistogram('http_request_duration_seconds', 'HTTP latency.', [0.1, 0.5, 1]);
    observe('http_request_duration_seconds', 0.05, { route: '/health' });
    observe('http_request_duration_seconds', 0.3, { route: '/health' });
    observe('http_request_duration_seconds', 2, { route: '/health' });

    const out = renderProm();
    expect(out).toContain('# TYPE http_request_duration_seconds histogram');
    // 0.05 falls in 0.1, 0.5, 1, +Inf.
    expect(out).toMatch(
      /http_request_duration_seconds_bucket\{le="0\.1",route="\/health"\} 1/,
    );
    // 0.05 and 0.3 fall in 0.5.
    expect(out).toMatch(
      /http_request_duration_seconds_bucket\{le="0\.5",route="\/health"\} 2/,
    );
    expect(out).toMatch(
      /http_request_duration_seconds_bucket\{le="\+Inf",route="\/health"\} 3/,
    );
    expect(out).toMatch(/http_request_duration_seconds_count\{route="\/health"\} 3/);
    expect(out).toMatch(/http_request_duration_seconds_sum\{route="\/health"\} 2\.35/);
  });

  it('exposes process gauges', () => {
    const out = renderProm();
    expect(out).toContain('process_resident_memory_bytes');
    expect(out).toContain('nodejs_heap_used_bytes');
    expect(out).toContain('process_uptime_seconds');
  });

  it('escapes label values safely', () => {
    incr('weird', 1, { tag: 'has "quote" and \\ slash' });
    const out = renderProm();
    expect(out).toContain('tag="has \\"quote\\" and \\\\ slash"');
  });

  it('keeps a JSON snapshot for back-compat', () => {
    incr('jobs_total', 4);
    const snap = snapshot();
    expect(snap.counters.jobs_total).toBe(4);
  });
});
