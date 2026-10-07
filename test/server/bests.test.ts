import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startApp, uniqueEmail } from './helpers.ts';

const app = startApp();
afterAll(() => app.close());

const trace = (lapTime: number) => ({ lapTime, t: [0, lapTime], d: [0, 2000] });

describe('bests', () => {
  const c = app.client();
  beforeAll(async () => {
    expect((await c.json('POST', '/api/auth/register', { email: uniqueEmail(), password: 'password1' })).status).toBe(201);
  });

  test('inserts, keeps the faster, and returns the merged set', async () => {
    let r = await c.json('PUT', '/api/bests', { bests: [{ circuitId: 'harbour', segmentId: '', trace: trace(200) }, { circuitId: 'harbour', segmentId: 'sprint-1', trace: trace(30) }] });
    expect(r.status).toBe(200);
    expect(r.body.bests.map((b: any) => [b.circuitId, b.segmentId, b.trace.lapTime])).toEqual([['harbour', '', 200], ['harbour', 'sprint-1', 30]]);
    r = await c.json('PUT', '/api/bests', { bests: [{ circuitId: 'harbour', segmentId: '', trace: trace(250) }] }); // slower: ignored
    expect(r.body.bests[0].trace.lapTime).toBe(200);
    r = await c.json('PUT', '/api/bests', { bests: [{ circuitId: 'harbour', trace: trace(180) }] }); // faster, segmentId omitted = lap
    expect(r.body.bests[0].trace.lapTime).toBe(180);
    r = await c.json('GET', '/api/bests');
    expect(r.body.bests.length).toBe(2);
    expect(typeof r.body.bests[0].updatedAt).toBe('number');
  });

  test('rejects bad batches', async () => {
    expect((await c.json('PUT', '/api/bests', { bests: 'no' })).status).toBe(400);
    expect((await c.json('PUT', '/api/bests', { bests: [{ circuitId: 'Bad!', trace: trace(1) }] })).status).toBe(400);
    expect((await c.json('PUT', '/api/bests', { bests: [{ circuitId: 'ok', trace: { lapTime: 5, t: [0, 9], d: [0, 1] } }] })).status).toBe(400);
    const many = Array.from({ length: 201 }, (_, i) => ({ circuitId: `c${i}`, trace: trace(1) }));
    expect((await c.json('PUT', '/api/bests', { bests: many })).status).toBe(400);
  });

  test('needs a session', async () => {
    expect((await app.client().json('GET', '/api/bests')).status).toBe(401);
  });
});
