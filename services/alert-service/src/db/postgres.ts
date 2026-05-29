import { Pool } from 'pg';
import { postgresConfig } from '../config';
import { logger } from '../logger';

let pool: Pool;

export async function connectPostgres(): Promise<void> {
  pool = new Pool({ connectionString: postgresConfig.uri });
  await pool.query('SELECT 1');
  logger.info('PostgreSQL connected');
}

export function getPool(): Pool {
  return pool;
}

export async function closePostgres(): Promise<void> {
  await pool?.end();
  logger.info('PostgreSQL disconnected');
}
