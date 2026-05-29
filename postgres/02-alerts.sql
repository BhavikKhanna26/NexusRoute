-- Migration: add alerts table
-- Run this against your already-running PostgreSQL instance:
--
--   docker exec -i nexusroute-postgres psql -U nexus -d nexusroute < postgres/02-alerts.sql

CREATE TABLE IF NOT EXISTS alerts (
    id                         SERIAL PRIMARY KEY,
    alert_id                   VARCHAR(64)  NOT NULL UNIQUE,
    awb_number                 VARCHAR(64)  NOT NULL,
    carrier_code               VARCHAR(32),
    seller_id                  VARCHAR(64)  NOT NULL,
    risk_score                 DECIMAL(4,3) NOT NULL,
    prediction_id              VARCHAR(64),
    origin_pincode             VARCHAR(10),
    destination_pincode        VARCHAR(10),
    promised_delivery_date     TIMESTAMPTZ,
    days_to_promised_delivery  INT,

    status          VARCHAR(16) NOT NULL DEFAULT 'NOTIFIED'
                    CHECK (status IN ('NOTIFIED', 'ACKNOWLEDGED', 'RESOLVED')),

    triggered_at    TIMESTAMPTZ NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ,
    trace_id        VARCHAR(64),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_seller_id    ON alerts (seller_id);
CREATE INDEX IF NOT EXISTS idx_alerts_awb_number   ON alerts (awb_number);
CREATE INDEX IF NOT EXISTS idx_alerts_open         ON alerts (seller_id, triggered_at DESC) WHERE status != 'RESOLVED';
CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at ON alerts (triggered_at DESC);
