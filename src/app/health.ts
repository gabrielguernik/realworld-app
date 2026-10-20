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
 * because the API keeps serving (from PostgreSQL) without it. A failure is logged with its reason.
 */
router.get('/readyz', async (req: Request, res: Response) => {
  const cache = await cacheStatus();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 1000);
    res.json({ status: 'ok', database: 'ok', cache });
  } catch (error) {
    const database = (error as Error).message;
    // Probes are left out of the access log, so log why this pod is out of rotation: at 3am this line is the
    // difference between "pods are unready" and "pods can't reach PostgreSQL".
    req.log.warn({ database, cache }, 'not ready: database check failed');
    res.status(503).json({ status: 'unavailable', database, cache });
  }
});

export default router;
