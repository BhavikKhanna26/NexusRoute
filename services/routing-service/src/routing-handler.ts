import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { appConfig } from './config';
import { getPool } from './db/postgres';
import { publishRoutingDecided } from './kafka/producer';
import { mlServingBreaker } from './circuit-breaker/circuit-breaker';
import { MLRankingStrategy } from './strategies/ml-ranking.strategy';
import { RuleBasedStrategy } from './strategies/rule-based.strategy';
import type { OrderCreatedEvent } from '@nexusroute/contracts';
import type { RoutingResult } from './strategies/types';

// Singletons — one instance per process, reused across every ORDER_CREATED message.
const mlStrategy   = new MLRankingStrategy(appConfig.ML_SERVING_URL);
const ruleStrategy = new RuleBasedStrategy();

export async function handleOrderCreated(event: OrderCreatedEvent): Promise<void> {
  const pool = getPool();

  // ── Idempotency guard ────────────────────────────────────────────────────────
  // Kafka delivers at-least-once. If the same ORDER_CREATED is delivered twice
  // (e.g. consumer restart after offset was processed but before commit),
  // the second call must be a no-op. We use the routing_decisions table as the
  // dedup store — if a row for this order_id already exists, skip.
  const existing = await pool.query<{ id: number }>(
    'SELECT id FROM routing_decisions WHERE order_id = $1 LIMIT 1',
    [event.order_id]
  );
  if (existing.rows.length > 0) {
    logger.warn({ order_id: event.order_id }, 'Routing decision already exists — duplicate event, skipping');
    return;
  }

  // ── Strategy selection ───────────────────────────────────────────────────────
  // Circuit breaker state drives which strategy runs:
  //   CLOSED / HALF_OPEN → try MLRankingStrategy (circuit breaker wraps the call)
  //   OPEN               → go straight to RuleBasedStrategy (fast-fail, no ML call)
  let result: RoutingResult;

  if (mlServingBreaker.currentState === 'OPEN') {
    logger.info({ order_id: event.order_id }, 'Circuit breaker OPEN — using rule-based strategy directly');
    result = await ruleStrategy.rank(event);
  } else {
    try {
      result = await mlServingBreaker.execute(() => mlStrategy.rank(event));
    } catch (err) {
      // ML call failed (timeout, 5xx, network error, or circuit just opened).
      // Fall back to rule-based so this order is not left unrouted.
      logger.warn(
        { order_id: event.order_id, circuitState: mlServingBreaker.currentState, error: err instanceof Error ? err.message : String(err) },
        'ML strategy failed — falling back to rule-based'
      );
      result = await ruleStrategy.rank(event);
    }
  }

  // ── PostgreSQL write (ACID) ──────────────────────────────────────────────────
  // routing_decisions is an immutable audit log. Every carrier selection — ML or
  // rule-based — is written here with full context. ACID means this either fully
  // commits or rolls back: there is no partial routing_decision in the DB.
  await pool.query(
    `INSERT INTO routing_decisions
       (order_id, awb_number, seller_id, selected_carrier_code,
        decision_reason, ml_rank_score, carrier_candidates, trace_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
    [
      event.order_id,
      event.awb_number,
      event.seller_id,
      result.selected_carrier_code,
      result.decision_reason,
      result.ml_rank_score,
      JSON.stringify(result.carrier_candidates),
      event.trace_id,
    ]
  );

  logger.info(
    { order_id: event.order_id, carrier: result.selected_carrier_code, reason: result.decision_reason },
    'Routing decision written to PostgreSQL'
  );

  // ── Kafka publish ────────────────────────────────────────────────────────────
  // At this point PostgreSQL has the routing_decision row but Order Service has
  // not yet received ROUTING_DECIDED. If publish fails, the order is stuck in
  // PENDING forever — the DB row exists but the event never fires.
  //
  // Full fix = outbox pattern: a background job polls routing_decisions for rows
  // where no corresponding ROUTING_DECIDED was acknowledged (needs an extra column),
  // then re-publishes. For Phase 2 we log with all identifiers so the problem is
  // observable and manually recoverable. The outbox processor is Phase 3+ work.
  try {
    await publishRoutingDecided({
      decision_id:           result.decision_id,
      order_id:              event.order_id,
      awb_number:            event.awb_number,
      seller_id:             event.seller_id,
      selected_carrier_code: result.selected_carrier_code,
      decision_reason:       result.decision_reason,
      ml_rank_score:         result.ml_rank_score,
      carrier_candidates:    result.carrier_candidates,
      decided_at:            new Date().toISOString(),
      trace_id:              event.trace_id,
    });
  } catch (err) {
    logger.error(
      {
        order_id:    event.order_id,
        decision_id: result.decision_id,
        trace_id:    event.trace_id,
        error:       err instanceof Error ? err.message : String(err),
      },
      'CRITICAL: Kafka publish failed after PostgreSQL write — order is stuck in PENDING. Manual recovery required.'
    );
    // Do NOT rethrow — rethrowing would cause the Kafka consumer to retry the entire
    // ORDER_CREATED message. On retry, the idempotency guard above would find the
    // existing routing_decision row and skip — resulting in the same stuck state.
    // The error log above is the recovery signal for ops / future outbox processor.
    return;
  }

  logger.info(
    { order_id: event.order_id, carrier: result.selected_carrier_code, reason: result.decision_reason },
    'Order routed successfully'
  );
}
