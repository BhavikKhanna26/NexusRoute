import { appConfig } from '../config';
import { createServiceClient } from './http';

const client = createServiceClient(appConfig.ALERT_SERVICE_URL);

export interface Alert {
  id: number;
  alert_id: string;
  awb_number: string;
  seller_id: string;
  risk_score: number;
  status: 'NOTIFIED' | 'ACKNOWLEDGED' | 'RESOLVED';
  triggered_at: string;
  acknowledged_at?: string;
  resolved_at?: string;
}

export interface AlertRule {
  id: number;
  seller_id: string;
  rule_name: string;
  risk_threshold: number;
  alert_channels: Array<{ type: string; address?: string; url?: string }>;
  is_active: boolean;
}

export const alertClient = {
  async listAlerts(sellerId: string, status: string | undefined, correlationId: string): Promise<Alert[]> {
    const params: Record<string, string> = { seller_id: sellerId };
    if (status) params.status = status;
    const { data } = await client.get<Alert[]>('/alerts', {
      params,
      headers: { 'X-Correlation-ID': correlationId },
    });
    return data;
  },

  async acknowledgeAlert(alertId: string, correlationId: string): Promise<Alert> {
    const { data } = await client.patch<Alert>(`/alerts/${alertId}/acknowledge`, {}, {
      headers: { 'X-Correlation-ID': correlationId },
    });
    return data;
  },

  async listAlertRules(sellerId: string, correlationId: string): Promise<AlertRule[]> {
    const { data } = await client.get<AlertRule[]>('/alert-rules', {
      params: { seller_id: sellerId },
      headers: { 'X-Correlation-ID': correlationId },
    });
    return data;
  },

  async createAlertRule(input: Omit<AlertRule, 'id'>, correlationId: string): Promise<AlertRule> {
    const { data } = await client.post<AlertRule>('/alert-rules', input, {
      headers: { 'X-Correlation-ID': correlationId },
    });
    return data;
  },

  async updateAlertRule(id: number, input: Partial<AlertRule>, correlationId: string): Promise<AlertRule> {
    const { data } = await client.put<AlertRule>(`/alert-rules/${id}`, input, {
      headers: { 'X-Correlation-ID': correlationId },
    });
    return data;
  },
};
