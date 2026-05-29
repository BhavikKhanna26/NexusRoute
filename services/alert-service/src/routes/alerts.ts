import { Router, Request, Response } from 'express';
import { getPool } from '../db/postgres';

export const alertsRouter = Router();

// GET /alerts?seller_id=X&status=NOTIFIED&limit=20&offset=0
alertsRouter.get('/', async (req: Request, res: Response) => {
  const { seller_id, status, limit = '20', offset = '0' } = req.query;

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (seller_id) {
    params.push(seller_id);
    conditions.push(`seller_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Number(limit), Number(offset));

  const result = await getPool().query(
    `SELECT alert_id, awb_number, carrier_code, seller_id, risk_score,
            origin_pincode, destination_pincode, promised_delivery_date,
            days_to_promised_delivery, status, triggered_at,
            acknowledged_at, resolved_at, created_at
     FROM   alerts
     ${where}
     ORDER  BY triggered_at DESC
     LIMIT  $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return res.json({ alerts: result.rows, count: result.rowCount });
});

// GET /alerts/:alertId
alertsRouter.get('/:alertId', async (req: Request, res: Response) => {
  const result = await getPool().query(
    'SELECT * FROM alerts WHERE alert_id = $1',
    [req.params.alertId]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Alert not found' });
  return res.json(result.rows[0]);
});

// PATCH /alerts/:alertId/acknowledge
alertsRouter.patch('/:alertId/acknowledge', async (req: Request, res: Response) => {
  const result = await getPool().query(
    `UPDATE alerts
     SET    status = 'ACKNOWLEDGED', acknowledged_at = NOW()
     WHERE  alert_id = $1 AND status = 'NOTIFIED'
     RETURNING alert_id, status, acknowledged_at`,
    [req.params.alertId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Alert not found or already acknowledged/resolved' });
  }
  return res.json(result.rows[0]);
});

// PATCH /alerts/:alertId/resolve
alertsRouter.patch('/:alertId/resolve', async (req: Request, res: Response) => {
  const result = await getPool().query(
    `UPDATE alerts
     SET    status = 'RESOLVED', resolved_at = NOW()
     WHERE  alert_id = $1 AND status IN ('NOTIFIED', 'ACKNOWLEDGED')
     RETURNING alert_id, status, resolved_at`,
    [req.params.alertId]
  );
  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Alert not found or already resolved' });
  }
  return res.json(result.rows[0]);
});
