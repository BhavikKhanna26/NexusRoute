import { Router, Request, Response } from 'express';
import { getPool } from '../db/postgres';
import { mlServingBreaker } from '../circuit-breaker/circuit-breaker';

export const routingRouter = Router();

// GET /routing/decisions/:orderId — internal endpoint consumed by GraphQL Gateway
routingRouter.get('/decisions/:orderId', async (req: Request, res: Response) => {
  const result = await getPool().query(
    `SELECT order_id, awb_number, seller_id, selected_carrier_code,
            decision_reason, ml_rank_score, carrier_candidates, decided_at, trace_id
     FROM   routing_decisions
     WHERE  order_id = $1
     ORDER  BY decided_at DESC
     LIMIT  1`,
    [req.params.orderId]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Routing decision not found' });
  }

  return res.json(result.rows[0]);
});

// GET /routing/circuit-breaker — operational visibility into circuit breaker state
routingRouter.get('/circuit-breaker', (_req: Request, res: Response) => {
  return res.json({ state: mlServingBreaker.currentState });
});
