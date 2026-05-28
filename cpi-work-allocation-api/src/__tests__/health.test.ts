import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';

const app = createApp();

afterAll(() => prisma.$disconnect());

describe('GET /api/health', () => {
  it('returns 200 with status:ok when DB is reachable', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.time).toBe('string');
  });
});
