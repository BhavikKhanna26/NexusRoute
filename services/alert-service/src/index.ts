import express, { Request, Response } from 'express';
import { appConfig } from './config';
import { connectPostgres, closePostgres } from './db/postgres';
import { connectConsumer, disconnectConsumer } from './kafka/consumer';
import { alertsRouter } from './routes/alerts';
import { alertRulesRouter } from './routes/alert-rules';
import { logger } from './logger';

const app = express();
app.use(express.json());

app.use('/alerts', alertsRouter);
app.use('/alert-rules', alertRulesRouter);
app.get('/health', (_req: Request, res: Response) =>
  res.json({ status: 'ok', service: 'alert-service', port: appConfig.PORT })
);

async function start(): Promise<void> {
  await connectPostgres();
  await connectConsumer();

  const server = app.listen(appConfig.PORT, () => {
    logger.info({ port: appConfig.PORT }, 'Alert service started');
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Shutdown initiated');
    server.close(async () => {
      await disconnectConsumer();
      await closePostgres();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error(err, 'Failed to start alert service');
  process.exit(1);
});
