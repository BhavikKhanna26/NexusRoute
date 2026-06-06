import { GraphQLError } from 'graphql';
import type { GraphQLContext } from '../context';
import { orderClient, type CreateOrderInput } from '../clients/order.client';
import { alertClient } from '../clients/alert.client';

export const resolvers = {
  Query: {
    order: async (
      _: unknown,
      { orderId }: { orderId: string },
      { correlationId, seller }: GraphQLContext
    ) => {
      const order = await orderClient.getOrder(orderId, correlationId);
      if (!order) throw new GraphQLError('Order not found', { extensions: { code: 'NOT_FOUND' } });

      // Sellers can only see their own orders
      if (order.seller_id !== seller.sellerId) {
        throw new GraphQLError('Forbidden', { extensions: { code: 'FORBIDDEN' } });
      }
      return order;
    },

    alerts: async (
      _: unknown,
      { status }: { status?: string },
      { correlationId, seller }: GraphQLContext
    ) => {
      return alertClient.listAlerts(seller.sellerId, status, correlationId);
    },

    alertRules: async (
      _: unknown,
      __: unknown,
      { correlationId, seller }: GraphQLContext
    ) => {
      return alertClient.listAlertRules(seller.sellerId, correlationId);
    },
  },

  Mutation: {
    createOrder: async (
      _: unknown,
      { input }: { input: CreateOrderInput },
      { correlationId }: GraphQLContext
    ) => {
      return orderClient.createOrder(input, correlationId);
    },

    acknowledgeAlert: async (
      _: unknown,
      { alertId }: { alertId: string },
      { correlationId }: GraphQLContext
    ) => {
      return alertClient.acknowledgeAlert(alertId, correlationId);
    },

    createAlertRule: async (
      _: unknown,
      { input }: { input: Parameters<typeof alertClient.createAlertRule>[0] },
      { correlationId, seller }: GraphQLContext
    ) => {
      return alertClient.createAlertRule({ ...input, seller_id: seller.sellerId }, correlationId);
    },

    updateAlertRule: async (
      _: unknown,
      { id, input }: { id: string; input: Parameters<typeof alertClient.updateAlertRule>[1] },
      { correlationId }: GraphQLContext
    ) => {
      return alertClient.updateAlertRule(Number(id), input, correlationId);
    },
  },

  // Field resolver — runs ONLY when routing_decision is requested on an Order.
  // Without DataLoader, fetching 10 orders would make 10 separate HTTP calls to
  // Routing Service. DataLoader batches these into a single call.
  Order: {
    routing_decision: async (
      order: { order_id: string },
      _: unknown,
      { loaders, correlationId }: GraphQLContext
    ) => {
      return loaders.routingDecision.load({ orderId: order.order_id, correlationId });
    },
  },
};
