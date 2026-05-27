import { MongoClient, Db } from 'mongodb';
import { mongoConfig } from '../config';
import { logger } from '../logger';

let logisticsClient: MongoClient;
let nexusrouteClient: MongoClient;

export async function connectMongo(): Promise<void> {
  logisticsClient = new MongoClient(mongoConfig.logistics.uri);
  nexusrouteClient = new MongoClient(mongoConfig.nexusroute.uri);

  await Promise.all([logisticsClient.connect(), nexusrouteClient.connect()]);
  logger.info('MongoDB connected (logistics + nexusroute)');
}

export function getLogisticsDb(): Db {
  return logisticsClient.db(mongoConfig.logistics.db);
}

export function getNexusrouteDb(): Db {
  return nexusrouteClient.db(mongoConfig.nexusroute.db);
}

export async function closeMongo(): Promise<void> {
  await Promise.all([logisticsClient?.close(), nexusrouteClient?.close()]);
  logger.info('MongoDB disconnected');
}
