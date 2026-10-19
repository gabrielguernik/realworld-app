import { Request, Response, Router } from 'express';
import prisma from '../prisma/prisma-client';
import { cacheStatus } from './cache';

const router = Router();

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);

/** Liveness: the process is up. No dependencies, so a database outage never restarts pods. */
router.get('/healthz', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

/**
 * Readiness: PostgreSQL must answer. The cache is reported but never fails readiness,
 * because the API keeps serving (from PostgreSQL) without it.
 */
router.get('/readyz', async (_req: Request, res: Response) => {
  const cache = await cacheStatus();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 1000);
    res.json({ status: 'ok', database: 'ok', cache });
  } catch (error) {
    res.status(503).json({ status: 'unavailable', database: (error as Error).message, cache });
  }
});

export default router;
