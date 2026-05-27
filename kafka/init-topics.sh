#!/bin/bash
# One-shot script: creates all Kafka topics for NexusRoute.
# Runs inside kafka-init container which only starts after Kafka is healthy.

set -e  # exit immediately if any command fails

BROKER="kafka:29092"

echo "==> Creating NexusRoute Kafka topics..."

# ─── order-events ─────────────────────────────────────────────────────────────
# Producer : Order Service
# Consumer : Routing Service
# Key      : seller_id  → orders from same seller go to same partition
# Partitions: 3  (order volume is low relative to tracking)
# Retention : 7 days (604800000 ms)
kafka-topics --bootstrap-server $BROKER \
  --create --if-not-exists \
  --topic order-events \
  --partitions 3 \
  --replication-factor 1 \
  --config retention.ms=604800000

# ─── tracking-updates ─────────────────────────────────────────────────────────
# Producer : Tracking Ingestion Service (Go)
# Consumer : SLA Monitoring Service (Go)
# Key      : awb_number → all scans for one shipment → same partition → ordered
# Partitions: 6  (highest volume: 10k events/min peak. 6 = 6 parallel SLA workers)
# This is the only topic with 6 partitions because it is the throughput bottleneck.
kafka-topics --bootstrap-server $BROKER \
  --create --if-not-exists \
  --topic tracking-updates \
  --partitions 6 \
  --replication-factor 1 \
  --config retention.ms=604800000

# ─── sla-alerts ───────────────────────────────────────────────────────────────
# Producer : SLA Monitoring Service
# Consumer : Alert Service
# Key      : seller_id → one seller's alert storm can't delay another seller's alerts
kafka-topics --bootstrap-server $BROKER \
  --create --if-not-exists \
  --topic sla-alerts \
  --partitions 3 \
  --replication-factor 1 \
  --config retention.ms=604800000

# ─── routing-decisions ────────────────────────────────────────────────────────
# Producer : Routing Service
# Consumer : Order Service
# Key      : order_id
kafka-topics --bootstrap-server $BROKER \
  --create --if-not-exists \
  --topic routing-decisions \
  --partitions 3 \
  --replication-factor 1 \
  --config retention.ms=604800000

# ─── model-feedback ───────────────────────────────────────────────────────────
# Producer : Order Service (on delivery scan)
# Consumer : ML batch pipeline (weekly retraining)
# Key      : awb_number
# Retention: 30 days (2592000000 ms) — longer because the ML pipeline is weekly.
#            A 7-day retention would drop feedback before the next training run.
kafka-topics --bootstrap-server $BROKER \
  --create --if-not-exists \
  --topic model-feedback \
  --partitions 3 \
  --replication-factor 1 \
  --config retention.ms=2592000000

echo "==> Topics created successfully."
echo ""
echo "==> Verifying:"
kafka-topics --bootstrap-server $BROKER --list
