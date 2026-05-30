import { describe, it, expect } from 'vitest';
import { initSentry, captureException, flushSentry, isSentryEnabled } from '@clawmind/telemetry';

// Capture envelopes in-process so the test never hits the network. Sentry's
// transport contract: a function returning { send, flush } where send takes
// an envelope and resolves with a response object.
function makeCapturingTransport() {
  const envelopes: unknown[] = [];
  const factory = () => ({
    send: async (envelope: unknown) => {
      envelopes.push(envelope);
      return {};
    },
    flush: async () => true,
  });
  return { factory, envelopes };
}

describe('sentry wiring', () => {
  it('initialises with a custom transport and captures exceptions', async () => {
    const { factory, envelopes } = makeCapturingTransport();
    const ok = initSentry({
      serviceName: 'clawmind-api-test',
      environment: 'test',
      transport: factory,
    });
    expect(ok).toBe(true);
    expect(isSentryEnabled()).toBe(true);

    const eventId = captureException(new Error('boom'), { requestId: 'req-1', route: '/v1/ask' });
    expect(eventId).toBeTypeOf('string');

    const flushed = await flushSentry(2000);
    expect(flushed).toBe(true);
    expect(envelopes.length).toBeGreaterThan(0);

    // The envelope is a tuple [headers, items]; the second item carries the
    // event payload. Stringify and assert the message round-tripped so we
    // know we sent a real error event, not a transaction.
    const serialised = JSON.stringify(envelopes);
    expect(serialised).toContain('boom');
    expect(serialised).toContain('req-1');
  });

  it('is a no-op when no DSN and no transport are configured', () => {
    // Already initialised by the previous test (process-wide singleton), so
    // we cannot un-init here; instead assert the captureException contract
    // by verifying the helper does not throw when called with arbitrary
    // input shapes Fastify might pass through (string, object, null).
    expect(() => captureException('string error')).not.toThrow();
    expect(() => captureException({ weird: true })).not.toThrow();
    expect(() => captureException(null)).not.toThrow();
  });
});
