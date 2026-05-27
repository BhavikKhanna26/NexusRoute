// Config modules read and validate process.env using Zod.
// dotenv is NOT loaded here — it is loaded before this process starts
// via the -r dotenv/config flag in the npm dev script.
// This separation is intentional: env loading is an infrastructure concern,
// env validation is a code concern.

export { appConfig }   from './app';
export { mongoConfig } from './mongo';
export { kafkaConfig } from './kafka';
