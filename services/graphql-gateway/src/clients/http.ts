import axios, { AxiosInstance } from 'axios';
import { appConfig } from '../config';

// Factory for downstream service HTTP clients.
// Every client sends INTERNAL_API_KEY and forwards X-Correlation-ID.
// The correlation ID is set per-request by the caller (from GraphQL context).
export function createServiceClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 5000,
    headers: {
      'X-Internal-API-Key': appConfig.INTERNAL_API_KEY,
      'Content-Type': 'application/json',
    },
  });
}
