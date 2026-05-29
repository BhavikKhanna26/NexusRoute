import { MongoClient, Db } from 'mongodb';
import { mongoConfig } from '../config';
import { logger } from '../logger';

let logisticsClient: MongoClient;

export async function connectMongo(): Promise<void> {
  logisticsClient = new MongoClient(mongoConfig.logistics.uri);
  await logisticsClient.connect();
  logger.info('MongoDB connected (logistics — read only)');
}

// Read-only access to the existing logistics cluster.
// RuleBasedStrategy uses this to look up carrier scores when ML Serving is unavailable.
export function getLogisticsDb(): Db {
  return logisticsClient.db(mongoConfig.logistics.db);
}

export async function closeMongo(): Promise<void> {
  await logisticsClient?.close();
  logger.info('MongoDB disconnected');
}
