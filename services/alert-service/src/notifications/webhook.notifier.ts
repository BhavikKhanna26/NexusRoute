import { logger } from '../logger';
import type { SlaAlertEvent } from '@nexusroute/contracts';
import type { AlertChannel, AlertRule } from './types';

export async function dispatchWebhook(
  channel: Extract<AlertChannel, { type: 'webhook' }>,
  event: SlaAlertEvent,
  rule: AlertRule,
): Promise<void> {
  const response = await fetch(channel.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      alert_id:    event.alert_id,
      awb_number:  event.awb_number,
      seller_id:   event.seller_id,
      risk_score:  event.risk_score,
      rule_name:   rule.rule_name,
      origin_pincode:      event.origin_pincode,
      destination_pincode: event.destination_pincode,
      promised_delivery_date:    event.promised_delivery_date,
      days_to_promised_delivery: event.days_to_promised_delivery,
      triggered_at: event.triggered_at,
    }),
  });

  if (!response.ok) {
    throw new Error(`Webhook POST to ${channel.url} returned ${response.status}`);
  }

  logger.info({ alert_id: event.alert_id, url: channel.url }, 'Webhook notification dispatched');
}
