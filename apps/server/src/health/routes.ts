import type { FastifyInstance } from 'fastify';

export type ReadinessCheck = () => Promise<void>;

export function registerHealthRoutes(app: FastifyInstance, checkReady: ReadinessCheck): void {
  app.get('/api/v1/health/live', { config: { public: true } }, async () => ({ status: 'ok' }));

  app.get('/api/v1/health/ready', { config: { public: true } }, async (_request, reply) => {
    try {
      await checkReady();
      return { status: 'ok' };
    } catch {
      return reply.code(503).send({ status: 'unavailable' });
    }
  });
}
