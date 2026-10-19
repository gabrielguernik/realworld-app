import { randomUUID } from 'crypto';
import pino from 'pino';
import pinoHttp from 'pino-http';
import config from './config';

/** Structured JSON logs on stdout; the container runtime ships them (Fluent Bit -> CloudWatch). */
const logger = pino({
  level: config.logLevel,
  base: { service: 'realworld-api' },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: ['req.headers.authorization', 'req.headers.cookie'],
});

const quietPaths = new Set(['/healthz', '/readyz', '/metrics']);

/**
 * Access logs. Every request gets an ID: the caller's X-Request-Id if sane, otherwise a new UUID.
 * It is returned in the response header and attached to every log line written through req.log.
 */
export const httpLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && /^[\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('X-Request-Id', id);
    return id;
  },
  customProps: (req) => ({ reqId: req.id }),
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  autoLogging: {
    ignore: (req) => quietPaths.has(req.url ?? ''),
  },
});

export default logger;
