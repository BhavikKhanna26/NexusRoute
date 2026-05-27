import express, { Request, Response } from 'express';
import { appConfig } from './config';
import { connectMongo, closeMongo } from './db/mongo';
import { connectProducer, disconnectProducer } from './kafka/producer';
import { connectConsumer, disconnectConsumer } from './kafka/consumer';
import { ordersRouter } from './routes/orders';
import { logger } from './logger';

const app = express();
app.use(express.json());

app.use('/orders', ordersRouter);
app.get('/health', (_req: Request, res: Response) => res.json({ status: 'ok', service: 'order-service', port: appConfig.PORT }));

async function start(): Promise<void> {
  await connectMongo();
  await connectProducer();
  await connectConsumer();

  const server = app.listen(appConfig.PORT, () => {
    logger.info({ port: appConfig.PORT }, 'Order service started');
  });

  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Shutdown initiated');
    server.close(async () => {
      await disconnectProducer();
      await disconnectConsumer();
      await closeMongo();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error(err, 'Failed to start order service');
  process.exit(1);
});
