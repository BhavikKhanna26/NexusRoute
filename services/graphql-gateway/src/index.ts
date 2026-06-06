import express from 'express';
import cors from 'cors';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { Redis } from 'ioredis';
import { appConfig } from './config';
import { typeDefs } from './schema/typedefs';
import { resolvers } from './schema/resolvers';
import { buildContext } from './context';
import { createRateLimiter } from './middleware/rate-limit';
import { logger } from './logger';
import type { GraphQLContext } from './context';

async function start(): Promise<void> {
  const app = express();

  // Redis client — shared between rate limiter and anything else that needs it
  const redis = new Redis(appConfig.REDIS_URL, {
    lazyConnect: false,
    maxRetriesPerRequest: 3,
  });

  redis.on('error', (err) => logger.error({ err }, 'Redis connection error'));
  await redis.ping(); // fail fast — if Redis is down, don't start
  logger.info('Redis connected');

  // Apollo Server — no auth here, auth happens in buildContext
  const server = new ApolloServer<GraphQLContext>({
    typeDefs,
    resolvers,
    // formatError strips internal details from prod errors — never leak stack traces
    formatError: (formattedError) => {
      if (appConfig.NODE_ENV === 'production') {
        return {
          message: formattedError.message,
          extensions: { code: formattedError.extensions?.code },
        };
      }
      return formattedError;
    },
  });

  await server.start();
  logger.info('Apollo Server started');

  app.use(
    '/graphql',
    cors<cors.CorsRequest>(),
    express.json(),
    createRateLimiter(redis),           // rate limit before Apollo processes
    expressMiddleware(server, {
      context: buildContext,            // JWT validation + DataLoader setup
    })
  );

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'graphql-gateway', port: appConfig.PORT });
  });

  const httpServer = app.listen(appConfig.PORT, () => {
    logger.info({ port: appConfig.PORT }, 'GraphQL Gateway started');
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Shutdown initiated');
    httpServer.close(async () => {
      await server.stop();
      await redis.quit();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error(err, 'Failed to start GraphQL Gateway');
  process.exit(1);
});
