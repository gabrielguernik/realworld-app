import { NextFunction, Request, Response } from 'express';
import client from 'prom-client';
import prisma from '../prisma/prisma-client';

export const register = new client.Registry();
register.setDefaultLabels({ service: 'realworld-api' });
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request latency by route template, method and status code',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const cacheRequests = new client.Counter({
  name: 'cache_requests_total',
  help: 'Cache lookups by cache name and result (hit, miss, error)',
  labelNames: ['cache', 'result'],
  registers: [register],
});

/** Times every request. The route label is the Express route template, never the raw URL. */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const end = httpRequestDuration.startTimer();
  res.on('finish', () => {
    const route = req.route ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    end({ method: req.method, route, status_code: String(res.statusCode) });
  });
  next();
};

/** Prometheus endpoint: process and HTTP metrics plus Prisma's connection pool and query metrics. */
export const metricsHandler = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [appMetrics, prismaMetrics] = await Promise.all([
      register.metrics(),
      prisma.$metrics.prometheus({ globalLabels: { service: 'realworld-api' } }),
    ]);
    res.set('Content-Type', register.contentType);
    res.send(`${appMetrics}\n${prismaMetrics}`);
  } catch (error) {
    next(error);
  }
};
