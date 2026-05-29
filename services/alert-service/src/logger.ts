import pino from 'pino';
import { appConfig } from './config';

export const logger = pino({
  level: appConfig.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { service: 'alert-service' },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: appConfig.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
