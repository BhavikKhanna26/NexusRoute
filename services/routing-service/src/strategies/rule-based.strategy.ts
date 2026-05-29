import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';
import { getLogisticsDb } from '../db/mongo';
import { COLLECTIONS } from '../db/collections';
import type { OrderCreatedEvent } from '@nexusroute/contracts';
import type { RoutingStrategy, RoutingResult } from './types';

// Last-resort static list used when the logistics DB is also unavailable.
// Ordered by historically known general performance — not route-specific.
const STATIC_CARRIER_DEFAULTS = [
  { carrier_code: 'BLUEDART',  score: 0.85 },
  { carrier_code: 'DELHIVERY', score: 0.78 },
  { carrier_code: 'DTDC',      score: 0.72 },
];

export class RuleBasedStrategy implements RoutingStrategy {
  async rank(event: OrderCreatedEvent): Promise<RoutingResult> {
    try {
      return await this.rankFromLogisticsDb(event);
    } catch (err) {
      logger.warn(
        { order_id: event.order_id, error: err instanceof Error ? err.message : String(err) },
        'RuleBasedStrategy DB lookup failed — using static defaults'
      );
      return this.staticFallback();
    }
  }

  private async rankFromLogisticsDb(event: OrderCreatedEvent): Promise<RoutingResult> {
    const db = getLogisticsDb();

    // Step 1: resolve pincodes → cities
    const [originDoc, destDoc] = await Promise.all([
      db.collection(COLLECTIONS.MST_PINCODES).findOne({ pincode: event.origin_pincode }),
      db.collection(COLLECTIONS.MST_PINCODES).findOne({ pincode: event.destination_pincode }),
    ]);

    if (!originDoc || !destDoc) {
      throw new Error(`Pincode not found: origin=${event.origin_pincode} dest=${event.destination_pincode}`);
    }

    // Step 2: fetch carrier mappings for this city-pair
    const mappings = await db.collection(COLLECTIONS.TMS_CITY_MAPPINGS).find({
      origin_city:      originDoc.city,
      destination_city: destDoc.city,
    }).toArray();

    if (!mappings.length) {
      throw new Error(`No carrier mappings for route ${originDoc.city as string} → ${destDoc.city as string}`);
    }

    // Step 3: score and sort — prefer 7d SLA rate (more recent), fall back to 30d, then 0
    const candidates = mappings
      .map(m => ({
        carrier_code: m.carrier_code as string,
        score: ((m.carrier_sla_rate_7d ?? m.carrier_sla_rate_30d ?? m.sla_rate ?? 0) as number),
      }))
      .filter(c => c.carrier_code)
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) {
      throw new Error('Carrier mapping rows had no usable carrier_code field');
    }

    logger.info(
      { order_id: event.order_id, route: `${originDoc.city as string}→${destDoc.city as string}`, top: candidates[0] },
      'RuleBasedStrategy: carrier selected from logistics DB'
    );

    return {
      decision_id:           uuidv4(),
      selected_carrier_code: candidates[0].carrier_code,
      decision_reason:       'RULE_FALLBACK',
      ml_rank_score:         null,
      carrier_candidates:    candidates.slice(0, 5),
    };
  }

  private staticFallback(): RoutingResult {
    logger.warn('RuleBasedStrategy: using static carrier defaults');
    return {
      decision_id:           uuidv4(),
      selected_carrier_code: STATIC_CARRIER_DEFAULTS[0].carrier_code,
      decision_reason:       'RULE_FALLBACK',
      ml_rank_score:         null,
      carrier_candidates:    STATIC_CARRIER_DEFAULTS,
    };
  }
}
