-- PostgreSQL initialization for NexusRoute.
-- Only two tables live here. Everything else is MongoDB.
-- See ADR-002 in HLD.md for why these two specifically are relational.

-- ═══════════════════════════════════════════════════════════════════════════════
-- routing_decisions
-- ───────────────────────────────────────────────────────────────────────────────
-- Immutable audit log. Every carrier selection — ML or rule-based fallback — is
-- written here. ACID guarantee: a routing decision either fully commits or rolls
-- back. No partial writes.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE routing_decisions (
    id                    SERIAL PRIMARY KEY,
    order_id              VARCHAR(64)     NOT NULL,
    awb_number            VARCHAR(64),
    seller_id             VARCHAR(64)     NOT NULL,
    selected_carrier_code VARCHAR(32)     NOT NULL,

    -- CHECK constraint enforces the two valid values at the DB level.
    -- Application code cannot accidentally write 'RANDOM' or an empty string.
    decision_reason       VARCHAR(16)     NOT NULL
                          CHECK (decision_reason IN ('ML_RANKED', 'RULE_FALLBACK')),

    -- NULL when decision_reason = 'RULE_FALLBACK' (ML wasn't called).
    ml_rank_score         DECIMAL(5, 4),

    -- Full ranked list stored as JSONB so we can inspect what alternatives existed
    -- without normalizing into a separate table.
    -- Example: [{"carrier_code": "BLUEDART", "score": 0.91}, ...]
    carrier_candidates    JSONB,

    decided_at            TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    trace_id              VARCHAR(64)
);

-- Query pattern: Routing Service / Gateway lookup by order
CREATE INDEX idx_routing_order_id     ON routing_decisions (order_id);

-- Query pattern: ops dashboard — all decisions for a seller
CREATE INDEX idx_routing_seller_id    ON routing_decisions (seller_id);

-- Query pattern: time-range analytics — "how many ML_RANKED vs RULE_FALLBACK
-- decisions happened today?" Tells us circuit breaker trigger frequency.
CREATE INDEX idx_routing_decided_at   ON routing_decisions (decided_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════════
-- sla_alert_rules
-- ───────────────────────────────────────────────────────────────────────────────
-- Per-seller configuration: at what risk_threshold should we fire, and where.
-- Relational because: sellers are a known entity, alert rules reference them,
-- and we want referential integrity + ACID on create/update/delete.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE sla_alert_rules (
    id              SERIAL PRIMARY KEY,
    seller_id       VARCHAR(64)     NOT NULL,
    rule_name       VARCHAR(128)    NOT NULL,

    -- DECIMAL(3,2): stores 0.00 to 0.99 — exactly what a 0–1 probability needs.
    -- CHECK enforces valid range at the DB level before application code touches it.
    risk_threshold  DECIMAL(3, 2)   NOT NULL DEFAULT 0.65
                    CHECK (risk_threshold > 0 AND risk_threshold <= 1),

    -- Variable structure: [{type: "email", address: "..."}, {type: "webhook", url: "..."}]
    -- JSONB (binary JSON) is indexed and queryable unlike TEXT. Correct type for
    -- semi-structured config that doesn't need its own normalized table.
    alert_channels  JSONB           NOT NULL DEFAULT '[]'::jsonb,

    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

-- Query pattern: Alert Service fetches active rules for a seller on every SLA alert.
-- This is the hot query path — runs on every triggered alert.
CREATE INDEX idx_alert_rules_seller_id  ON sla_alert_rules (seller_id);

-- Partial index: only indexes rows where is_active = TRUE.
-- Alert Service only ever queries active rules. This index is smaller and faster
-- than a full index on (seller_id, is_active) because it excludes deleted/disabled rules.
CREATE INDEX idx_alert_rules_active
    ON sla_alert_rules (seller_id)
    WHERE is_active = TRUE;


-- ═══════════════════════════════════════════════════════════════════════════════
-- Trigger: auto-update updated_at on sla_alert_rules
-- ───────────────────────────────────────────────────────────────────────────────
-- Without this, application code must remember to set updated_at on every UPDATE.
-- A trigger makes it structural — impossible to forget.
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sla_alert_rules_updated_at
    BEFORE UPDATE ON sla_alert_rules
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
