import { logger } from './logger';
import { getPool } from './db/postgres';
import { dispatchWebhook } from './notifications/webhook.notifier';
import { dispatchEmail } from './notifications/email.notifier';
import type { SlaAlertEvent } from '@nexusroute/contracts';
import type { AlertChannel, AlertRule } from './notifications/types';

export async function handleSlaAlert(event: SlaAlertEvent): Promise<void> {
  const pool = getPool();

  // ── Idempotency guard ────────────────────────────────────────────────────────
  // alert_id has a UNIQUE constraint in the alerts table — a duplicate INSERT
  // would throw. Check first so we can log a clear message instead of a PG error.
  const existing = await pool.query<{ id: number }>(
    'SELECT id FROM alerts WHERE alert_id = $1',
    [event.alert_id]
  );
  if (existing.rows.length > 0) {
    logger.warn({ alert_id: event.alert_id }, 'Alert already stored — duplicate event, skipping');
    return;
  }

  // ── Persist alert before dispatching notifications ───────────────────────────
  // Store first so the alert is never lost even if notification dispatch fails.
  // Status starts as NOTIFIED — ops team moves it to ACKNOWLEDGED / RESOLVED.
  await pool.query(
    `INSERT INTO alerts
       (alert_id, awb_number, carrier_code, seller_id, risk_score,
        prediction_id, origin_pincode, destination_pincode,
        promised_delivery_date, days_to_promised_delivery,
        status, triggered_at, trace_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'NOTIFIED',$11,$12)`,
    [
      event.alert_id,
      event.awb_number,
      event.carrier_code,
      event.seller_id,
      event.risk_score,
      event.prediction_id,
      event.origin_pincode,
      event.destination_pincode,
      event.promised_delivery_date,
      event.days_to_promised_delivery,
      event.triggered_at,
      event.trace_id,
    ]
  );

  logger.info({ alert_id: event.alert_id, awb: event.awb_number, risk: event.risk_score }, 'Alert stored');

  // ── Load seller's active alert rules ─────────────────────────────────────────
  const rulesResult = await pool.query<AlertRule>(
    'SELECT * FROM sla_alert_rules WHERE seller_id = $1 AND is_active = TRUE',
    [event.seller_id]
  );

  if (rulesResult.rows.length === 0) {
    logger.info({ seller_id: event.seller_id, alert_id: event.alert_id }, 'No active rules for seller — alert stored, no notifications sent');
    return;
  }

  // ── Evaluate rules and dispatch ──────────────────────────────────────────────
  // Each rule has its own risk_threshold. An alert only triggers a rule if
  // risk_score >= that rule's threshold. A seller can have multiple rules
  // with different thresholds targeting different channels (e.g. email at 0.65,
  // PagerDuty webhook at 0.85).
  for (const rule of rulesResult.rows) {
    if (event.risk_score < Number(rule.risk_threshold)) {
      logger.debug(
        { alert_id: event.alert_id, rule_id: rule.id, score: event.risk_score, threshold: rule.risk_threshold },
        'Score below rule threshold — skipping rule'
      );
      continue;
    }

    const channels: AlertChannel[] = Array.isArray(rule.alert_channels) ? rule.alert_channels : [];

    for (const channel of channels) {
      try {
        if (channel.type === 'webhook') {
          await dispatchWebhook(channel, event, rule);
        } else if (channel.type === 'email') {
          await dispatchEmail(channel, event, rule);
        } else {
          logger.warn({ channel }, 'Unknown notification channel type — skipping');
        }
      } catch (err) {
        // One channel failure must not block the others.
        // The alert is already stored — ops can re-trigger manually if needed.
        logger.error(
          { alert_id: event.alert_id, rule_id: rule.id, channel_type: channel.type, error: err instanceof Error ? err.message : String(err) },
          'Notification dispatch failed'
        );
      }
    }
  }

  logger.info({ alert_id: event.alert_id, seller_id: event.seller_id }, 'Alert processing complete');
}
