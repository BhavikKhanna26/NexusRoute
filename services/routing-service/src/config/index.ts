// Config modules read and validate process.env using Zod.
// dotenv is NOT loaded here — it is loaded before this process starts
// via the -r dotenv/config flag in the npm dev script.

export { appConfig }      from './app';
export { kafkaConfig }    from './kafka';
export { mongoConfig }    from './mongo';
export { postgresConfig } from './postgres';
