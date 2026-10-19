/**
 * Runtime configuration, read once from the environment.
 * In production (NODE_ENV=production) required settings must be present: the process exits at startup
 * instead of running with a development default.
 */
const isProduction = process.env.NODE_ENV === 'production';

const required = (name: string, developmentDefault?: string): string => {
  const value = process.env[name];
  if (value) {
    return value;
  }
  if (!isProduction && developmentDefault !== undefined) {
    return developmentDefault;
  }
  throw new Error(`Missing required environment variable ${name}`);
};

const config = {
  isProduction,
  port: Number(process.env.PORT ?? 3000),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  jwtSecret: required('JWT_SECRET', 'superSecret'),
  // Prisma reads DATABASE_URL itself; checked here so a missing value fails fast.
  databaseUrl: required('DATABASE_URL', ''),
  // Optional: without it the cache is disabled and every read goes to PostgreSQL.
  redisUrl: process.env.REDIS_URL || undefined,
};

export default config;
