import { z } from 'zod';

// Minimal by design (tech §10): no operational detail.
export const HealthOk = z.strictObject({ status: z.literal('ok') }).meta({ id: 'HealthOk' });
export type HealthOk = z.infer<typeof HealthOk>;

export const HealthUnavailable = z
  .strictObject({ status: z.literal('unavailable') })
  .meta({ id: 'HealthUnavailable' });
export type HealthUnavailable = z.infer<typeof HealthUnavailable>;
