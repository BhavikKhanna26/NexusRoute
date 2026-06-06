import DataLoader from 'dataloader';
import { routingClient, type RoutingDecision } from '../clients/routing.client';

interface RoutingKey {
  orderId: string;
  correlationId: string;
}

// DataLoader is created ONCE PER REQUEST (in context.ts), not as a singleton.
// If it were a singleton, it would cache results across requests — a seller
// would see another seller's routing decisions.
//
// Batch function contract: input array length === output array length,
// same index order. DataLoader uses index to map results back to callers.
export function createRoutingDecisionLoader() {
  return new DataLoader<RoutingKey, RoutingDecision | null>(
    async (keys) => {
      // All keys in one batch share the same correlationId (same request).
      const correlationId = keys[0]?.correlationId ?? '';

      // Fetch all decisions in parallel — one HTTP call per order.
      // In a real system with a /routing/decisions?orderIds=a,b,c bulk endpoint,
      // this would be a single HTTP call. For now, parallel is still better than sequential.
      const results = await Promise.allSettled(
        keys.map(({ orderId }) => routingClient.getDecision(orderId, correlationId))
      );

      // Map back to input order — DataLoader requirement
      return results.map((result) =>
        result.status === 'fulfilled' ? result.value : null
      );
    },
    {
      // Cache within a single request — deduplicates if the same order_id
      // appears twice in one GraphQL query (e.g. via aliases or fragments).
      cache: true,
    }
  );
}
