import { appConfig } from '../config';
import { createServiceClient } from './http';

const client = createServiceClient(appConfig.ORDER_SERVICE_URL);

export interface Order {
  order_id: string;
  awb_number: string;
  seller_id: string;
  status: string;
  carrier_code?: string;
  origin_pincode: string;
  destination_pincode: string;
  weight_grams: number;
  service_type: string;
  payment_method: string;
  promised_sla_days: number;
  created_at: string;
  updated_at: string;
}

export interface CreateOrderInput {
  seller_id: string;
  origin_pincode: string;
  destination_pincode: string;
  weight_grams: number;
  service_type: string;
  payment_method: string;
  promised_sla_days: number;
}

export const orderClient = {
  async createOrder(input: CreateOrderInput, correlationId: string): Promise<Order> {
    const { data } = await client.post<Order>('/orders', input, {
      headers: { 'X-Correlation-ID': correlationId },
    });
    return data;
  },

  async getOrder(orderId: string, correlationId: string): Promise<Order | null> {
    try {
      const { data } = await client.get<Order>(`/orders/${orderId}`, {
        headers: { 'X-Correlation-ID': correlationId },
      });
      return data;
    } catch (err: unknown) {
      if (axios404(err)) return null;
      throw err;
    }
  },

  // Used by DataLoader — fetches a single shipment by AWB
  async getShipmentByAwb(awbNumber: string, correlationId: string): Promise<Order | null> {
    try {
      const { data } = await client.get<Order>(`/orders/${awbNumber}/status`, {
        headers: { 'X-Correlation-ID': correlationId },
      });
      return data;
    } catch (err: unknown) {
      if (axios404(err)) return null;
      throw err;
    }
  },
};

function axios404(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    (err as { response: { status: number } }).response?.status === 404
  );
}
