import express from 'express';
import cors from 'cors';
import * as bodyParser from 'body-parser';
import routes from './app/routes/routes';
import HttpException from './app/models/http-exception.model';
import config from './app/config';
import logger, { httpLogger } from './app/logger';
import { metricsHandler, metricsMiddleware } from './app/metrics';
import health from './app/health';
import { closeCache } from './app/cache';
import prisma from './prisma/prisma-client';

const app = express();
app.disable('x-powered-by');

/**
 * App Configuration
 */

app.use(httpLogger);
app.use(metricsMiddleware);
app.use(health);
app.get('/metrics', metricsHandler);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(routes);

// Serves images
app.use(express.static(__dirname + '/assets'));

app.get('/', (req: express.Request, res: express.Response) => {
  res.json({ status: 'API is running on /api' });
});

/* eslint-disable */
app.use(
  (
    err: Error | HttpException,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    // @ts-ignore
    if (err && err.name === 'UnauthorizedError') {
      return res.status(401).json({
        status: 'error',
        message: 'missing authorization credentials',
      });
      // @ts-ignore
    } else if (err && err.errorCode) {
      // @ts-ignore
      res.status(err.errorCode).json(err.message);
    } else if (err) {
      req.log.error({ err }, 'unhandled error');
      res.status(500).json(err.message);
    }
  },
);
/* eslint-enable */

/**
 * Server activation
 */

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, 'server up');
});

/**
 * Graceful shutdown: on SIGTERM (Kubernetes pod termination) stop accepting connections,
 * let in-flight requests finish, then close the database pool and the cache connection.
 */
const shutdown = (signal: string) => {
  logger.info({ signal }, 'shutting down');
  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, exiting');
    process.exit(1);
  }, 20_000);
  forceExit.unref();

  server.close(async () => {
    await Promise.allSettled([prisma.$disconnect(), closeCache()]);
    logger.info('shutdown complete');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
