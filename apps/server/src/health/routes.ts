import type { FastifyInstance } from 'fastify';

export type ReadinessCheck = () => Promise<void>;

export function registerHealthRoutes(app: FastifyInstance, checkReady: ReadinessCheck): void {
  app.get('/api/v1/health/live', async () => ({ status: 'ok' }));

  app.get('/api/v1/health/ready', async (_request, reply) => {
    try {
      await checkReady();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
