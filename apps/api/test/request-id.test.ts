import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requestIdPlugin, pickRequestId, REQUEST_ID_HEADER } from '../src/plugins/request-id.js';

function build() {
  const app = Fastify({
    genReqId: (req) => pickRequestId(req.headers[REQUEST_ID_HEADER]),
    requestIdLogLabel: 'requestId',
  });
  app.register(requestIdPlugin);
  app.get('/ping', async (req) => ({ id: req.id }));
  return app;
}

describe('request-id plugin', () => {
  it('echoes a safe inbound X-Request-Id on the response', async () => {
    const app = build();
    const incoming = 'trace-abc12345';
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-request-id': incoming },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toBe(incoming);
    expect(JSON.parse(res.payload).id).toBe(incoming);
    await app.close();
  });

  it('generates a req_ prefixed id when the header is missing', async () => {
    const app = build();
    const res = await app.inject({ method: 'GET', url: '/ping' });
    expect(res.statusCode).toBe(200);
    const id = res.headers['x-request-id'] as string;
    expect(id).toMatch(/^req_[A-Za-z0-9_-]{16}$/);
    expect(JSON.parse(res.payload).id).toBe(id);
    await app.close();
  });

  it('rejects unsafe inbound ids and mints a fresh one', async () => {
    const app = build();
    const res = await app.inject({
      method: 'GET',
      url: '/ping',
      headers: { 'x-request-id': 'bad id with spaces and ;' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-request-id']).toMatch(/^req_/);
    await app.close();
  });

  it('rejects an id that is too short', () => {
    expect(pickRequestId('abc')).toMatch(/^req_/);
  });

  it('keeps long but valid ids', () => {
    const long = 'a'.repeat(64);
    expect(pickRequestId(long)).toBe(long);
  });
});
