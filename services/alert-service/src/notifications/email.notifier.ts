import { logger } from '../logger';
import type { SlaAlertEvent } from '@nexusroute/contracts';
import type { AlertChannel, AlertRule } from './types';

// Placeholder — logs the email that would be sent.
// Replace with nodemailer / SendGrid in Phase 4+ when SMTP config is available.
export async function dispatchEmail(
  channel: Extract<AlertChannel, { type: 'email' }>,
  event: SlaAlertEvent,
  rule: AlertRule,
): Promise<void> {
  logger.info(
    {
      to:          channel.address,
      alert_id:    event.alert_id,
      awb_number:  event.awb_number,
      seller_id:   event.seller_id,
      risk_score:  event.risk_score,
      rule_name:   rule.rule_name,
      triggered_at: event.triggered_at,
    },
    'Email notification (placeholder — configure SMTP in Phase 4 to send real emails)',
  );
}
