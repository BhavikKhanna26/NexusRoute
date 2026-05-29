import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import type { OrderCreatedEvent } from '@nexusroute/contracts';
import type { RoutingStrategy, RoutingResult } from './types';

interface MLRankCarriersResponse {
  ranked_carriers: Array<{ carrier_code: string; score: number }>;
}

export class MLRankingStrategy implements RoutingStrategy {
  constructor(private readonly mlServingUrl: string) {}

  async rank(event: OrderCreatedEvent): Promise<RoutingResult> {
    const response = await fetch(`${this.mlServingUrl}/rank/carriers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id:          event.order_id,
        origin_pincode:    event.origin_pincode,
        destination_pincode: event.destination_pincode,
        weight_grams:      event.weight_grams,
        service_type:      event.service_type,
        payment_method:    event.payment_method,
        promised_sla_days: event.promised_sla_days,
        trace_id:          event.trace_id,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ML Serving /rank/carriers returned ${response.status}: ${body}`);
    }

    const body = (await response.json()) as MLRankCarriersResponse;

    if (!body.ranked_carriers?.length) {
      throw new Error('ML Serving returned an empty carrier list');
    }

    logger.debug({ order_id: event.order_id, top_carrier: body.ranked_carriers[0] }, 'ML ranking received');

    return {
      decision_id:           uuidv4(),
      selected_carrier_code: body.ranked_carriers[0].carrier_code,
      decision_reason:       'ML_RANKED',
      ml_rank_score:         body.ranked_carriers[0].score,
      carrier_candidates:    body.ranked_carriers,
    };
  }
}
