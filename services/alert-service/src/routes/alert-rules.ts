import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getPool } from '../db/postgres';

export const alertRulesRouter = Router();

const ChannelSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('email'),   address: z.string().email() }),
  z.object({ type: z.literal('webhook'), url: z.string().url() }),
]);

const AlertRuleSchema = z.object({
  seller_id:       z.string().min(1),
  rule_name:       z.string().min(1).max(128),
  risk_threshold:  z.number().min(0.01).max(1.0),
  alert_channels:  z.array(ChannelSchema).default([]),
  is_active:       z.boolean().default(true),
});

// GET /alert-rules?seller_id=X
alertRulesRouter.get('/', async (req: Request, res: Response) => {
  const { seller_id } = req.query;

  const result = seller_id
    ? await getPool().query(
        'SELECT * FROM sla_alert_rules WHERE seller_id = $1 ORDER BY created_at DESC',
        [seller_id]
      )
    : await getPool().query('SELECT * FROM sla_alert_rules ORDER BY created_at DESC');

  return res.json({ rules: result.rows });
});

// GET /alert-rules/:id
alertRulesRouter.get('/:id', async (req: Request, res: Response) => {
  const result = await getPool().query(
    'SELECT * FROM sla_alert_rules WHERE id = $1',
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
  return res.json(result.rows[0]);
});

// POST /alert-rules
alertRulesRouter.post('/', async (req: Request, res: Response) => {
  const parsed = AlertRuleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });

  const { seller_id, rule_name, risk_threshold, alert_channels, is_active } = parsed.data;

  const result = await getPool().query(
    `INSERT INTO sla_alert_rules (seller_id, rule_name, risk_threshold, alert_channels, is_active)
     VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING *`,
    [seller_id, rule_name, risk_threshold, JSON.stringify(alert_channels), is_active]
  );

  return res.status(201).json(result.rows[0]);
});

// PUT /alert-rules/:id
alertRulesRouter.put('/:id', async (req: Request, res: Response) => {
  const parsed = AlertRuleSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten().fieldErrors });

  const fields = parsed.data;
  const sets: string[] = [];
  const params: unknown[] = [];

  if (fields.rule_name !== undefined)      { params.push(fields.rule_name);                       sets.push(`rule_name = $${params.length}`); }
  if (fields.risk_threshold !== undefined) { params.push(fields.risk_threshold);                  sets.push(`risk_threshold = $${params.length}`); }
  if (fields.alert_channels !== undefined) { params.push(JSON.stringify(fields.alert_channels));  sets.push(`alert_channels = $${params.length}::jsonb`); }
  if (fields.is_active !== undefined)      { params.push(fields.is_active);                       sets.push(`is_active = $${params.length}`); }

  if (sets.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  params.push(req.params.id);
  const result = await getPool().query(
    `UPDATE sla_alert_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );

  if (result.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
  return res.json(result.rows[0]);
});

// DELETE /alert-rules/:id
alertRulesRouter.delete('/:id', async (req: Request, res: Response) => {
  const result = await getPool().query(
    'DELETE FROM sla_alert_rules WHERE id = $1 RETURNING id',
    [req.params.id]
  );
  if (result.rows.length === 0) return res.status(404).json({ error: 'Rule not found' });
  return res.status(204).send();
});
