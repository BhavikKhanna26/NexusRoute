// Alert Service touches only PostgreSQL and Kafka — no MongoDB dependency.

export { appConfig }      from './app';
export { kafkaConfig }    from './kafka';
export { postgresConfig } from './postgres';
