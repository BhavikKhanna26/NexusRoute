import type { SlaAlertEvent } from '@nexusroute/contracts';

export type AlertChannel =
  | { type: 'email';   address: string }
  | { type: 'webhook'; url: string };

export interface AlertRule {
  id: number;
  seller_id: string;
  rule_name: string;
  risk_threshold: number;
  alert_channels: AlertChannel[];
  is_active: boolean;
}

export interface Notifier {
  dispatch(channel: AlertChannel, event: SlaAlertEvent, rule: AlertRule): Promise<void>;
}
