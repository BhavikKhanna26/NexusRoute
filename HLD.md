# High-Level Design (HLD)
## AI-Powered Predictive SLA Breach & Smart Carrier Routing Platform

---

| Field        | Value                                      |
|--------------|--------------------------------------------|
| Version      | 1.0                                        |
| Status       | APPROVED — baseline for Phase 1            |
| Date         | 2026-05-23                                 |
| Author       | Bhavik Khanna                              |
| Reviewer     | (to be filled during team review)          |

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Goals and Non-Goals](#2-goals-and-non-goals)
3. [Non-Functional Requirements](#3-non-functional-requirements)
4. [High-Level Architecture Diagram](#4-high-level-architecture-diagram)
5. [Component Breakdown](#5-component-breakdown)
6. [Data Architecture](#6-data-architecture)
7. [Key Data Flows](#7-key-data-flows)
8. [API Surface](#8-api-surface)
9. [Kafka Topic Design](#9-kafka-topic-design)
10. [ML Architecture](#10-ml-architecture)
11. [Observability Architecture](#11-observability-architecture)
12. [Security Design](#12-security-design)
13. [Scalability and Reliability](#13-scalability-and-reliability)
14. [Architecture Decision Records](#14-architecture-decision-records)
15. [Open Questions](#15-open-questions)

---

## 1. System Overview

### What This System Does

This platform solves two problems that every logistics company faces at scale:

**Problem 1 — SLA Breaches are discovered too late.**
Today, operations teams find out a shipment is going to be late only when it actually becomes late. At that point the customer has already had a bad experience. This system predicts breach risk in real-time — every time a new tracking scan arrives for a shipment, an XGBoost model scores it (0.0 to 1.0). If the score crosses a configurable threshold, an alert fires before the breach happens.

**Problem 2 — Carrier assignment is done on intuition or simple rules.**
Most platforms pick the cheapest carrier or the one with a rate contract. They do not factor in: how has this carrier performed on this specific route in the last 7 days? Is the destination pincode currently experiencing delays? What is the carrier's real-time load? This system uses a LightGBM ranker to answer these questions at order creation time and recommend the best carrier.

### Who Uses It

| User | What They Do |
|---|---|
| Seller / E-commerce brand | Creates orders, sees carrier recommendations, receives SLA breach alerts |
| Operations team | Monitors high-risk shipments, manages alert rules, investigates incidents |
| ML Engineer | Monitors model health, triggers retraining, compares model versions |
| Platform Admin | Configures carrier rules, manages seller settings |

### Scope

This is a **greenfield system** built on top of an existing MongoDB database (Logistics schema). New services are added alongside the existing data — no migration of existing data is required to start.

---

## 2. Goals and Non-Goals

### Goals

- Predict SLA breach risk for every active shipment on every tracking scan
- Rank available carriers at order creation using ML-driven signals
- Alert sellers and operations teams proactively when breach risk is high
- Serve ML predictions at <10ms latency (warm Redis cache path)
- Provide explainability for every prediction via SHAP values
- Support shadow mode model deployment — new model runs alongside current before being promoted
- Full observability: every request traceable end-to-end via distributed tracing

### Non-Goals

- This system does not process payments or manage rate contracts
- This system does not replace the existing carrier integration layer (it reads from it)
- This system does not migrate existing MongoDB data to any other store
- Real-time weather API integration is out of scope for v1 (weather risk score defaults to 0.0)
- Mobile application is out of scope — web dashboard only

---

## 3. Non-Functional Requirements

| Category | Requirement | Measurement |
|---|---|---|
| Tracking Ingestion throughput | Handle 10,000 carrier webhook events per minute at peak | k6 load test: p99 latency < 200ms, zero message loss |
| ML inference latency (warm) | SLA breach prediction with Redis cache hit | p99 < 10ms |
| ML inference latency (cold) | SLA breach prediction without cache | p99 < 50ms |
| Carrier ranking latency | Carrier rank at order creation | p99 < 100ms |
| End-to-end breach alert | From tracking scan arrival to alert dispatched | < 60 seconds |
| System availability | Core order and tracking path | 99.5% monthly |
| ML service availability | Prediction endpoint | 99.0% monthly |
| Kafka consumer lag | Under normal load | < 5 seconds |
| Feature freshness | Time since last nightly aggregation job | ≤ 24 hours |
| Redis cache TTL | Feature cache expiry | 6 hours (refreshed before expiry) |
| Prediction accuracy gate | XGBoost SLA breach predictor before promotion | AUC-ROC ≥ 0.82 |
| Ranking quality gate | LightGBM carrier ranker before promotion | NDCG@3 ≥ 0.75 |

---

## 4. High-Level Architecture Diagram

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                           EXTERNAL ACTORS                              │
  │   Carrier APIs (webhooks) ──────────────────────────────────────────►  │
  │   Sellers / Ops Team (browser) ──────────────────────────────────────► │
  └──────────────┬──────────────────────────────┬─────────────────────────┘
                 │ POST /webhook/tracking        │ HTTPS (browser)
                 ▼                               ▼
  ┌──────────────────────────┐   ┌───────────────────────────────────────┐
  │  Tracking Ingestion (Go) │   │      Next.js Frontend  (port 3010)    │
  │  port 8080               │   │      Seller Dashboard · Ops Monitor   │
  │  Worker Pool pattern     │   │      ML Model Health · Alert Center   │
  └──────────────┬───────────┘   └──────────────────┬────────────────────┘
                 │ produces                          │ GraphQL over HTTPS
                 │                                   ▼
                 │               ┌───────────────────────────────────────┐
                 │               │    GraphQL Gateway  (port 3000)       │
                 │               │    Node.js · JWT Auth · Rate Limiting │
                 │               │    OpenTelemetry instrumented         │
                 │               └──────┬──────────────┬────────────┬────┘
                 │                      │ HTTP          │ HTTP       │ HTTP
                 │               ┌──────▼───┐  ┌───────▼────┐  ┌────▼──────┐
                 │               │  Order   │  │  Routing   │  │  Alert    │
                 │               │ Service  │  │  Service   │  │  Service  │
                 │               │ Node.js  │  │  Node.js   │  │  Node.js  │
                 │               │ port 3001│  │  port 3002 │  │  port 3003│
                 │               └──────────┘  └─────┬──────┘  └───────────┘
                 │                                   │ HTTP (sync)
                 │                                   │ + circuit breaker
                 │                                   │
                 │               ┌───────────────────▼───────────────────┐
                 │               │       ML Serving Service              │
                 │               │       Python / FastAPI  (port 8000)   │
                 │               │       XGBoost · LightGBM · SHAP       │
                 │               │       Shadow Mode · Prediction Log     │
                 │               └───────────────────┬───────────────────┘
                 │                                   │ sync read
                 │                                   ▼
                 │               ┌───────────────────────────────────────┐
                 │               │   Redis Feature Cache  (port 6379)    │
                 │               │   Pre-fetched features · TTL 6h       │
                 │               └───────────────────────────────────────┘
                 │
                 ▼ (all services produce to Kafka)
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                           APACHE KAFKA  (port 9092)                     │
  │                                                                         │
  │   order-events ─── tracking-updates ─── sla-alerts ─── routing-decisions│
  │                               model-feedback                            │
  └──────────────────┬──────────────────────────────────────────────────────┘
                     │ consumes
                     ▼
  ┌──────────────────────────────────────────────────────────────────────┐
  │              SLA Monitoring Service (Go)  (internal)                 │
  │              Worker Pool · consumes tracking-updates                  │
  │              → calls ML Serving (sync + circuit breaker)             │
  │              → publishes sla-alerts when score > threshold           │
  └──────────────────────────────────────────────────────────────────────┘


  ┌──────────────────────────────────────────────────────────────────────┐
  │                          DATA LAYER                                   │
  ├────────────────────┬──────────────────────┬──────────────────────────┤
  │     MongoDB        │     PostgreSQL        │        Redis             │
  │   port 27017       │     port 5432         │      port 6379           │
  │                    │                       │                          │
  │ oms_shipments      │ routing_decisions     │ features:<awb>           │
  │ oms_shipment_      │ sla_alert_rules       │ carriers:<origin>:<dest> │
  │   tracking         │                       │ TTL: 6 hours             │
  │ shipment_sla_      │                       │                          │
  │   events           │                       │                          │
  │ carrier_perf_      │                       │                          │
  │   metrics          │                       │                          │
  │ pincode_delay_     │                       │                          │
  │   index            │                       │                          │
  │ ml_predictions     │                       │                          │
  │ (+ all existing    │                       │                          │
  │  Logistics         │                       │                          │
  │  collections)      │                       │                          │
  └────────────────────┴──────────────────────┴──────────────────────────┘


  ┌──────────────────────────────────────────────────────────────────────┐
  │                       OBSERVABILITY LAYER                             │
  │                                                                       │
  │  OpenTelemetry SDK (all 7 services) ──────► Jaeger UI   port 16686   │
  │  Prometheus scraping (all services) ──────► Grafana     port 3100    │
  │  Structured JSON logs (pino/zap/structlog)  correlation_id, trace_id  │
  └──────────────────────────────────────────────────────────────────────┘


  ┌──────────────────────────────────────────────────────────────────────┐
  │                         ML PLATFORM LAYER                             │
  │                                                                       │
  │  MLflow (experiments + model registry)  ──────────────  port 5000    │
  │  Nightly batch jobs (feature aggregation + Redis refresh)            │
  │  Weekly / drift-triggered retraining pipeline                        │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## 5. Component Breakdown

### 5.1 GraphQL Gateway
**Language:** Node.js + TypeScript  
**Port:** 3000  
**Pattern:** API Gateway / Aggregator

**Responsibilities:**
- Single entry point for the frontend — no service is called directly by the browser
- JWT validation on every request (RS256 asymmetric keys)
- Rate limiting: 100 requests/minute per seller
- Composes data from Order, Routing, and Alert services into unified GraphQL responses
- Forwards correlation ID and trace context to downstream services

**What it does NOT do:**
- Contains zero business logic
- Does not write to any database directly
- Does not connect to Kafka

---

### 5.2 Order Service
**Language:** Node.js + TypeScript  
**Port:** 3001  
**Pattern:** State Machine

**Order lifecycle states:**
```
PENDING → CARRIER_ASSIGNED → PICKUP_SCHEDULED → IN_TRANSIT → DELIVERED
                                                            → NDR
                                                            → RTO_INITIATED → RTO_DELIVERED
```

**Responsibilities:**
- Creates shipments in MongoDB (`oms_shipments`)
- Manages order state transitions (rejects invalid transitions — e.g., cannot go from DELIVERED back to IN_TRANSIT)
- Publishes `ORDER_CREATED` event to Kafka on creation
- Consumes `ROUTING_DECIDED` event from Kafka and updates shipment with assigned carrier
- Exposes REST API for Gateway

**Kafka role:** Producer (`order-events`), Consumer (`routing-decisions`)

---

### 5.3 Routing Service
**Language:** Node.js + TypeScript  
**Port:** 3002  
**Pattern:** Strategy Pattern

**Two strategies — selected at runtime:**
- `MLRankingStrategy`: calls ML Serving `/rank/carriers`, applies serviceability filter, returns top carrier
- `RuleBasedStrategy`: fallback when ML Serving is unavailable (circuit breaker open) — picks carrier by static SLA score from `tms_city_to_city_shipper_category_mappings`

**Responsibilities:**
- Consumes `ORDER_CREATED` events from Kafka
- Calls ML Serving synchronously (with circuit breaker — max 200ms timeout)
- Applies serviceability rules on top of ML ranking (ODA check, rate caps)
- Writes routing decision to PostgreSQL `routing_decisions`
- Publishes `ROUTING_DECIDED` event to Kafka

**Kafka role:** Consumer (`order-events`), Producer (`routing-decisions`)

---

### 5.4 Alert Service
**Language:** Node.js + TypeScript  
**Port:** 3003  
**Pattern:** Observer

**Responsibilities:**
- Consumes `SLA_ALERT` events from Kafka
- Reads seller-specific alert rules from PostgreSQL `sla_alert_rules`
- Dispatches notifications based on rules: email / webhook / (SMS in future)
- Exposes REST API to manage alert rules (CRUD)
- Exposes REST API to list, acknowledge, and resolve alerts

**Kafka role:** Consumer (`sla-alerts`)

---

### 5.5 Tracking Ingestion Service
**Language:** Go  
**Port:** 8080  
**Pattern:** Worker Pool

**Why Go:** This service handles bursts of 10,000+ webhook events per minute from multiple carriers firing simultaneously. Go's goroutines and channel-based worker pools handle this with low memory overhead and predictable latency. A Node.js event loop would require careful tuning to avoid head-of-line blocking under the same load.

**Responsibilities:**
- Exposes `POST /webhook/tracking` — the only external-facing webhook endpoint
- Validates HMAC-SHA256 signature on every request (rejects without processing if invalid)
- Returns HTTP 200 immediately — all processing is async
- Dispatches work to a fixed-size worker pool (goroutines)
- Each worker: normalises carrier-specific scan format → writes to MongoDB `oms_shipment_tracking` → publishes to Kafka
- Kafka offset is committed ONLY after MongoDB write succeeds — guarantees no lost events

**Kafka role:** Producer (`tracking-updates`)

---

### 5.6 SLA Monitoring Service
**Language:** Go  
**Port:** Internal (no external port)  
**Pattern:** Observer + Worker Pool

**Why Go:** Processes every tracking update for every active shipment. At scale, this is thousands of Kafka messages per minute, each requiring a synchronous ML call. Go's concurrency model (goroutines + context cancellation) handles this more efficiently than async/await in Node.js.

**Responsibilities:**
- Consumes `TRACKING_UPDATE` events from Kafka (worker pool pattern — parallel processing)
- For each event: calls ML Serving `POST /predict/sla-breach` synchronously
- If ML Serving unavailable (circuit breaker open): logs warning, commits offset, moves on — does NOT block the consumer
- If `risk_score > configured_threshold` (default 0.65): publishes `SLA_ALERT` to Kafka
- Updates `shipment_sla_events` in MongoDB with latest prediction score

**Kafka role:** Consumer (`tracking-updates`), Producer (`sla-alerts`)

---

### 5.7 ML Serving Service
**Language:** Python  
**Port:** 8000  
**Framework:** FastAPI

**Responsibilities:**
- Loads models from MLflow Model Registry at startup (production-tagged versions)
- `POST /predict/sla-breach`: returns breach risk score (0–1) + SHAP values for each feature
- `POST /rank/carriers`: returns carriers ranked by LightGBM score for a given order
- `GET /predict/{prediction_id}/explain`: detailed SHAP breakdown for a past prediction
- `GET /model/health`: current model versions, accuracy metrics, drift status
- Checks Redis for pre-fetched features on every inference call (cache-first pattern)
- Logs every prediction to MongoDB `ml_predictions`
- Supports shadow mode: when a new model version is in "shadow" state, runs both models — old model result is returned to caller, new model result is logged but not acted on

**Synchronous callers:** Routing Service (carrier ranking), SLA Monitoring Service (breach prediction)

---

### 5.8 Frontend
**Language:** TypeScript  
**Framework:** Next.js 14 (App Router)  
**Port:** 3010

**Talks exclusively to the GraphQL Gateway — never to individual services directly.**

| Screen | Purpose |
|---|---|
| Shipment Risk Monitor | Live table of in-transit shipments sorted by breach risk score. Color-coded. Click a row → SHAP breakdown panel showing why the score is high. |
| Carrier Performance | Per-carrier SLA rate, NDR rate, load score for 7d and 30d windows. Time-series charts. Route drilldown. |
| Order Creation Demo | Form: origin pincode + destination pincode + weight + service type → system returns ranked carrier list with scores. Demonstrates carrier ranker. |
| Alert Center | All triggered alerts, status (notified / acknowledged / resolved), severity, associated shipment. |
| ML Model Health | Prediction accuracy over time, score distribution, model version comparison, drift indicator. |
| Analytics | Delay heatmap by pincode, carrier comparison table, festival-period delay analysis. Powered by dbt models. |

---

## 6. Data Architecture

### Why Polyglot Persistence

Two databases are used. Each is chosen for a specific reason — not arbitrarily.

| Store | Role | Justification |
|---|---|---|
| MongoDB | Primary store for all shipment, tracking, ML data | Existing production schema lives here. Document model handles variable-structure scan events and feature arrays naturally. Horizontal scale path exists. |
| PostgreSQL | New relational entities only (`routing_decisions`, `sla_alert_rules`) | These two entities have relational integrity requirements: alert rules reference sellers and carriers by foreign key, routing decisions must be auditable with ACID guarantees. |
| Redis | ML feature cache | Pre-computed features for active shipments. Reading from MongoDB at inference time would add 30–60ms per call. Redis brings this to <2ms. |

### MongoDB Collections

**Existing (read + derive features, do not modify schema):**

| Collection | ML Use |
|---|---|
| `oms_shipments` | AWB, carrier, weight, pincode, payment method |
| `oms_shipment_tracking` | Scan events, delivered_date, initial_courier_edd → ground truth label |
| `tms_shipper_freight_categories` | Static carrier performance scores, service type |
| `tms_city_to_city_shipper_category_mappings` | City-pair carrier SLA/NDR/EDD scores |
| `tms_shipper_freight_category_delay_pincodes` | Active delay flags per pincode |
| `tms_shipper_freight_category_delay_events` | Delay event log with start/end dates |
| `mst_pincodes` | Pincode to city, region, lat/lon |
| `mst_holiday_calendar` | Festival dates with impacted_level and state |
| `tms_freight_zone_pincodes` | Carrier zone per pincode |
| `tms_city_to_city_mappings` | City-pair transit time in days |

**New (created for this project):**

**`shipment_sla_events`** — Materialized training record. One document per shipment, containing all ML features at the time of last prediction + the ground truth label set at delivery.

Key fields:
```
awb_number, carrier_code, origin/destination pincodes and cities,
weight_grams, weight_category, service_type, payment_method,
pickup_date, promised_delivery_date, actual_delivery_date,
promised_window_days, days_in_transit_at_prediction, days_to_promised_delivery,
is_weekend_order, is_festival_period, festival_name,
destination_pincode_delay_index, carrier_sla_rate_30d, carrier_sla_rate_7d,
carrier_avg_nps_7d, carrier_current_load_score, route_coverage_flag,
weather_risk_score,
sla_breached (ground truth label), breach_reason, days_delayed,
model_version_at_prediction, prediction_score, prediction_label
```

Indexes: `{ awb_number: 1 }` unique · `{ carrier_code, sla_breached, created_at }` · `{ destination_pincode, created_at }`

---

**`carrier_performance_metrics`** — Rolling aggregated carrier stats per route per time window. Written by nightly batch job.

Key fields:
```
carrier_code, origin_city, destination_city,
window_days (7 or 30), window_end_date,
total_shipments, on_time_deliveries, sla_compliance_rate,
avg_delivery_days, ndr_rate, rto_rate, avg_transit_delay_days,
avg_nps_score, load_score, computed_at
```

Indexes: `{ carrier_code, origin_city, destination_city, window_days, window_end_date }` · `{ window_end_date }` for purging

---

**`pincode_delay_index`** — Historical delay rate per destination pincode. Replaces the binary active-flag from `tms_shipper_freight_category_delay_pincodes` with a continuous quantitative score.

Key fields:
```
pincode, city, state, region,
window_days, window_end_date,
total_shipments, delayed_shipments, delay_rate,
avg_delay_days, p90_delay_days,
has_active_delay_event, active_delay_severity,
oda_type, computed_at
```

Indexes: `{ pincode, window_days, window_end_date }` · `{ delay_rate }` for routing queries

---

**`ml_predictions`** — Every inference logged. Input features snapshot, score, threshold, decision, and eventual outcome for drift monitoring and retraining feedback loop.

Key fields:
```
prediction_id (UUID), prediction_type (SLA_BREACH | CARRIER_RANK),
awb_number, carrier_code,
model_name, model_version, predicted_at,
input_features (embedded document — full feature snapshot),
risk_score, threshold_used, prediction_label, confidence_band,
actual_outcome, actual_sla_breached, outcome_recorded_at,
was_correct (derived),
latency_ms
```

Indexes: `{ prediction_id }` unique · `{ awb_number }` · `{ model_version, predicted_at }` · `{ was_correct, predicted_at }`

---

### PostgreSQL Tables

**`routing_decisions`**
```sql
id            SERIAL PRIMARY KEY
order_id      VARCHAR(64) NOT NULL
awb_number    VARCHAR(64)
seller_id     VARCHAR(64) NOT NULL
selected_carrier_code  VARCHAR(32) NOT NULL
decision_reason        VARCHAR(16) NOT NULL  -- 'ML_RANKED' | 'RULE_FALLBACK'
ml_rank_score          DECIMAL(5,4)          -- score from LightGBM, null if fallback
carrier_candidates     JSONB                 -- full ranked list with scores
decided_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
trace_id      VARCHAR(64)
```

**`sla_alert_rules`**
```sql
id              SERIAL PRIMARY KEY
seller_id       VARCHAR(64) NOT NULL
rule_name       VARCHAR(128) NOT NULL
risk_threshold  DECIMAL(3,2) NOT NULL DEFAULT 0.65
alert_channels  JSONB NOT NULL  -- [{type: 'email', address: '...'}, {type: 'webhook', url: '...'}]
is_active       BOOLEAN NOT NULL DEFAULT TRUE
created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

---

### Redis Key Design

| Key Pattern | Value | TTL |
|---|---|---|
| `features:shipment:{awb_number}` | JSON object — all ML features for breach prediction | 6 hours |
| `features:carrier:{origin_city}:{dest_city}` | JSON object — carrier performance metrics for ranking | 6 hours |
| `model:versions` | JSON object — current production model versions | 1 hour |

---

## 7. Key Data Flows

### Flow 1: Order Creation and Carrier Assignment

```
Seller                  Gateway           Order Service        Routing Service     ML Serving
  │                        │                    │                    │                  │
  │  POST /graphql         │                    │                    │                  │
  │  createOrder(...)      │                    │                    │                  │
  │───────────────────────►│                    │                    │                  │
  │                        │ validate JWT        │                    │                  │
  │                        │ POST /orders        │                    │                  │
  │                        │────────────────────►│                    │                  │
  │                        │                    │ write to MongoDB    │                  │
  │                        │                    │ (status: PENDING)   │                  │
  │                        │                    │ publish             │                  │
  │                        │                    │ ORDER_CREATED       │                  │
  │                        │                    │ → Kafka             │                  │
  │                        │                    │ return order_id     │                  │
  │                        │◄────────────────────│                    │                  │
  │◄───────────────────────│                    │                    │                  │
  │  {order_id, status}    │                    │                    │                  │
  │                        │                    │  consume            │                  │
  │                        │                    │  ORDER_CREATED      │                  │
  │                        │                    │  ◄──────────────────│                  │
  │                        │                    │                    │ POST /rank/carriers│
  │                        │                    │                    │──────────────────►│
  │                        │                    │                    │                  │ check Redis
  │                        │                    │                    │                  │ run LightGBM
  │                        │                    │                    │◄──────────────────│
  │                        │                    │                    │ {ranked_carriers}  │
  │                        │                    │                    │ apply rules        │
  │                        │                    │                    │ write PostgreSQL   │
  │                        │                    │                    │ publish            │
  │                        │                    │                    │ ROUTING_DECIDED    │
  │                        │                    │                    │ → Kafka            │
  │                        │                    │ consume             │                  │
  │                        │                    │ ROUTING_DECIDED     │                  │
  │                        │                    │◄────────────────────│                  │
  │                        │                    │ update MongoDB      │                  │
  │                        │                    │ (carrier assigned)  │                  │
```

**Circuit breaker behavior:** If ML Serving does not respond within 200ms, Routing Service switches to `RuleBasedStrategy` automatically. The `decision_reason` field in `routing_decisions` is set to `RULE_FALLBACK`. The circuit breaker opens after 5 consecutive failures and attempts recovery every 30 seconds.

---

### Flow 2: Tracking Update and SLA Breach Detection

```
Carrier API        Tracking Ingestion     Kafka          SLA Monitoring       ML Serving
    │                     │                 │                  │                   │
    │ POST /webhook/      │                 │                  │                   │
    │   tracking          │                 │                  │                   │
    │────────────────────►│                 │                  │                   │
    │                     │ validate HMAC   │                  │                   │
    │◄────────────────────│                 │                  │                   │
    │  HTTP 200           │ dispatch to     │                  │                   │
    │  (async)            │ worker pool     │                  │                   │
    │                     │ normalize event │                  │                   │
    │                     │ write MongoDB   │                  │                   │
    │                     │ (only then)     │                  │                   │
    │                     │ publish         │                  │                   │
    │                     │ TRACKING_UPDATE │                  │                   │
    │                     │────────────────►│                  │                   │
    │                     │                 │ consume          │                   │
    │                     │                 │ TRACKING_UPDATE  │                   │
    │                     │                 │─────────────────►│                   │
    │                     │                 │                  │ POST /predict/    │
    │                     │                 │                  │   sla-breach      │
    │                     │                 │                  │──────────────────►│
    │                     │                 │                  │                   │ check Redis
    │                     │                 │                  │                   │ run XGBoost
    │                     │                 │                  │                   │ compute SHAP
    │                     │                 │                  │                   │ log to MongoDB
    │                     │                 │                  │◄──────────────────│
    │                     │                 │                  │ {risk_score: 0.78}│
    │                     │                 │                  │                   │
    │                     │                 │  if score > 0.65 │                   │
    │                     │                 │  publish         │                   │
    │                     │                 │  SLA_ALERT       │                   │
    │                     │                 │◄─────────────────│                   │
    │                     │                 │                  │                   │
                                  │
                          Alert Service
                                  │
                          consume SLA_ALERT
                          read alert rules (PostgreSQL)
                          dispatch notification
```

**Failure handling in SLA Monitoring:** If ML Serving is unavailable, the service logs a warning and commits the Kafka offset. It does NOT retry indefinitely — this would cause consumer lag to grow and block all subsequent predictions. The missed prediction is an acceptable tradeoff compared to a stalled consumer.

---

### Flow 3: Nightly ML Pipeline (00:30 IST daily)

```
Cron Scheduler
      │
      │ 00:30 IST
      ▼
Step 1 — Feature Aggregation Job (Python)
      │
      ├── Query oms_shipment_tracking (last 30 days)
      ├── Compute rolling SLA rate, NDR rate, avg delay per carrier per city-pair
      ├── Upsert into carrier_performance_metrics (window_days=30 and window_days=7)
      ├── Compute delay rate per destination pincode
      ├── Upsert into pincode_delay_index
      └── Run data validation (Great Expectations):
          - No null carrier_code in computed metrics
          - sla_compliance_rate between 0 and 1
          - delay_rate between 0 and 1
          → If validation fails: halt, fire Grafana alert, do not proceed

Step 2 — Redis Cache Refresh Job (Python)
      │
      ├── Query MongoDB for all AWBs with status IN_TRANSIT
      ├── For each AWB: join features from carrier_performance_metrics + pincode_delay_index
      ├── Write to Redis key: features:shipment:{awb_number}  TTL=6h
      └── Write to Redis key: features:carrier:{origin}:{dest}  TTL=6h

Step 3 — Retraining Pipeline (weekly OR when drift score < threshold)
      │
      ├── Read shipment_sla_events for training window (last 90 days)
      ├── Run feature engineering pipeline
      ├── Train XGBoost (SLA breach predictor)
      │   └── Log to MLflow: params, metrics, model artifact
      ├── Train LightGBM (carrier ranker)
      │   └── Log to MLflow: params, metrics, model artifact
      ├── Evaluate:
      │   ├── XGBoost AUC-ROC >= 0.82? → pass gate
      │   └── LightGBM NDCG@3 >= 0.75? → pass gate
      ├── If both gates pass:
      │   ├── Register new versions in MLflow Model Registry (status: Staging)
      │   └── Enable shadow mode in ML Serving (feature flag)
      └── After 48h shadow period:
          ├── Compare shadow model accuracy vs production model
          ├── If shadow model is better → promote to Production in MLflow
          └── If worse → keep current production model, log comparison to Grafana
```

---

## 8. API Surface

### GraphQL Gateway (port 3000)

```
POST   /graphql          GraphQL endpoint (all queries and mutations)
GET    /health           Service health
```

Key GraphQL operations:
```graphql
Query:
  shipments(filter: ShipmentFilter): [Shipment]
  shipment(awbNumber: String!): Shipment
  alerts(status: AlertStatus): [Alert]
  carrierPerformance(carrierId: String, windowDays: Int): [CarrierMetrics]
  alertRules(sellerId: String!): [AlertRule]
  modelHealth: ModelHealthReport

Mutation:
  createOrder(input: CreateOrderInput!): Order
  acknowledgeAlert(alertId: ID!): Alert
  createAlertRule(input: AlertRuleInput!): AlertRule
  updateAlertRule(id: ID!, input: AlertRuleInput!): AlertRule
```

---

### Order Service (port 3001) — internal REST

```
POST   /orders                       Create new order
GET    /orders/:id                   Get order by ID
GET    /orders/:awbNumber/status     Get order status
PATCH  /orders/:id/status            Update order status (internal — called by Routing Service result)
GET    /health
```

---

### Routing Service (port 3002) — internal REST

```
GET    /routing/decisions/:orderId   Get routing decision for an order
GET    /health
```

---

### Alert Service (port 3003) — internal REST

```
GET    /alerts                       List alerts (paginated, filterable by status/severity)
GET    /alerts/:id                   Get alert by ID
PATCH  /alerts/:id/acknowledge       Acknowledge alert
PATCH  /alerts/:id/resolve           Resolve alert
GET    /alert-rules                  List alert rules
POST   /alert-rules                  Create alert rule
PUT    /alert-rules/:id              Update alert rule
DELETE /alert-rules/:id              Delete alert rule
GET    /health
```

---

### Tracking Ingestion Service (port 8080) — external-facing

```
POST   /webhook/tracking             Receive carrier tracking webhook
GET    /health
GET    /metrics                      Prometheus metrics
```

---

### ML Serving Service (port 8000) — internal REST

```
POST   /predict/sla-breach           Predict breach risk for a shipment
POST   /rank/carriers                Rank carriers for an order
GET    /predict/:predictionId/explain  SHAP breakdown for a past prediction
GET    /model/health                 Model versions, accuracy, drift status
GET    /health
GET    /metrics                      Prometheus metrics
```

`POST /predict/sla-breach` request shape:
```json
{
  "awb_number": "RS123456789IN",
  "carrier_code": "DTDC",
  "origin_city": "Mumbai",
  "destination_city": "Lucknow",
  "days_in_transit": 3,
  "promised_window_days": 5,
  "days_to_promised_delivery": 2,
  "weight_category": "MEDIUM",
  "service_type": "SURFACE",
  "payment_method": "COD",
  "is_weekend": false,
  "is_festival_period": false
}
```

`POST /predict/sla-breach` response shape:
```json
{
  "prediction_id": "uuid-v4",
  "awb_number": "RS123456789IN",
  "risk_score": 0.78,
  "threshold": 0.65,
  "prediction_label": "BREACH",
  "confidence_band": "HIGH_RISK",
  "shap_values": {
    "carrier_sla_rate_7d": 0.31,
    "destination_pincode_delay_index": 0.18,
    "days_in_transit_ratio": 0.14,
    "is_festival_period": 0.09
  },
  "model_version": "v1.2.0",
  "latency_ms": 7
}
```

---

## 9. Kafka Topic Design

### Topic Overview

| Topic | Partitions | Key | Retention | Producers | Consumers |
|---|---|---|---|---|---|
| `order-events` | 3 | `seller_id` | 7 days | Order Service | Routing Service |
| `tracking-updates` | 6 | `awb_number` | 7 days | Tracking Ingestion | SLA Monitoring |
| `sla-alerts` | 3 | `seller_id` | 7 days | SLA Monitoring | Alert Service |
| `routing-decisions` | 3 | `order_id` | 7 days | Routing Service | Order Service |
| `model-feedback` | 3 | `awb_number` | 30 days | Order Service (on delivery) | ML batch pipeline |

**Why keyed by `awb_number` for `tracking-updates`?**
All tracking scans for the same shipment are routed to the same partition. This ensures the SLA Monitoring consumer processes scans for a shipment in order — preventing a later scan from being processed before an earlier one.

**Why keyed by `seller_id` for `sla-alerts`?**
Alert Service can have one consumer instance per seller (partition-level isolation), preventing one seller's alert storm from delaying another seller's notifications.

### Message Schemas

**`order-events`**
```json
{
  "event_id": "uuid-v4",
  "event_type": "ORDER_CREATED",
  "awb_number": "RS123456789IN",
  "order_id": "ORD-2026-001",
  "seller_id": "SELLER-42",
  "origin_pincode": "400001",
  "destination_pincode": "226001",
  "weight_grams": 1200,
  "service_type": "SURFACE",
  "payment_method": "COD",
  "promised_sla_days": 5,
  "created_at": "2026-05-23T10:00:00Z",
  "trace_id": "abc123def456"
}
```

**`tracking-updates`**
```json
{
  "event_id": "uuid-v4",
  "awb_number": "RS123456789IN",
  "carrier_code": "DTDC",
  "seller_id": "SELLER-42",
  "scan_datetime": "2026-05-23T14:32:00Z",
  "status_code": "IN_TRANSIT",
  "location": "Lucknow Hub",
  "location_pincode": "226001",
  "raw_status": "Shipment arrived at hub",
  "trace_id": "abc123def456"
}
```

**`sla-alerts`**
```json
{
  "alert_id": "uuid-v4",
  "awb_number": "RS123456789IN",
  "carrier_code": "DTDC",
  "seller_id": "SELLER-42",
  "risk_score": 0.78,
  "prediction_id": "uuid-v4",
  "origin_pincode": "400001",
  "destination_pincode": "226001",
  "promised_delivery_date": "2026-05-25T00:00:00Z",
  "days_to_promised_delivery": 2,
  "triggered_at": "2026-05-23T14:32:15Z",
  "trace_id": "abc123def456"
}
```

**`routing-decisions`**
```json
{
  "decision_id": "uuid-v4",
  "order_id": "ORD-2026-001",
  "awb_number": "RS123456789IN",
  "seller_id": "SELLER-42",
  "selected_carrier_code": "BLUEDART",
  "decision_reason": "ML_RANKED",
  "ml_rank_score": 0.91,
  "carrier_candidates": [
    { "carrier_code": "BLUEDART", "score": 0.91 },
    { "carrier_code": "DTDC", "score": 0.74 },
    { "carrier_code": "DELHIVERY", "score": 0.68 }
  ],
  "decided_at": "2026-05-23T10:00:08Z",
  "trace_id": "abc123def456"
}
```

**`model-feedback`**
```json
{
  "feedback_id": "uuid-v4",
  "prediction_id": "uuid-v4",
  "awb_number": "RS123456789IN",
  "actual_outcome": "BREACHED",
  "actual_delivery_date": "2026-05-27T16:45:00Z",
  "promised_delivery_date": "2026-05-25T00:00:00Z",
  "days_delayed": 2,
  "feedback_at": "2026-05-27T17:00:00Z"
}
```

### Idempotency Strategy

Every consumer checks `event_id` before processing. If the same `event_id` has already been processed (tracked in a Redis set with 24h TTL), the message is acknowledged and skipped. This handles Kafka's at-least-once delivery guarantee.

---

## 10. ML Architecture

### 10.1 SLA Breach Predictor

**Algorithm:** XGBoost (binary classification)  
**Training label:** `sla_breached` (boolean) — derived from `delivered_date > initial_courier_edd`  
**Training data source:** `shipment_sla_events` collection  
**Prediction trigger:** Every tracking scan event for an in-transit shipment

**Feature set:**

| Feature | Type | Source |
|---|---|---|
| `days_in_transit` | continuous | Computed: (scan_datetime - pickup_date) in days |
| `promised_window_days` | continuous | initial_courier_edd - pickup_date |
| `transit_ratio` | continuous | days_in_transit / promised_window_days |
| `days_to_promised_delivery` | continuous | (promised_delivery_date - now) in days |
| `carrier_sla_rate_30d` | continuous | carrier_performance_metrics |
| `carrier_sla_rate_7d` | continuous | carrier_performance_metrics |
| `carrier_ndr_rate_30d` | continuous | carrier_performance_metrics |
| `carrier_current_load_score` | continuous 0–1 | carrier_performance_metrics |
| `destination_pincode_delay_index` | continuous 0–1 | pincode_delay_index |
| `destination_pincode_p90_delay` | continuous | pincode_delay_index |
| `is_weekend_order` | binary | Derived from order_created_at |
| `is_festival_period` | binary | mst_holiday_calendar |
| `route_coverage_flag` | categorical (3) | tms_shipper_freight_category_pincodes |
| `weight_category` | categorical (4) | oms_shipments.weight bucketed |
| `service_type` | categorical (3) | tms_shipper_freight_categories |
| `payment_method` | binary (COD/PREPAID) | oms_shipments |
| `weather_risk_score` | continuous 0–1 | Default 0.0 in v1 |

**Performance gate before promotion:** AUC-ROC ≥ 0.82, Precision ≥ 0.75 at threshold 0.65

---

### 10.2 Smart Carrier Ranker

**Algorithm:** LightGBM (learning-to-rank, LambdaRank objective)  
**Training label:** Relevance score derived from: on-time delivery (3 points) + no NDR (1 point) + NPS score (0–1 scaled)  
**Prediction trigger:** ORDER_CREATED event consumed by Routing Service

**Feature set (per carrier candidate):**

| Feature | Source |
|---|---|
| `carrier_sla_rate_30d_on_route` | carrier_performance_metrics |
| `carrier_sla_rate_7d_on_route` | carrier_performance_metrics |
| `carrier_ndr_rate_30d` | carrier_performance_metrics |
| `carrier_rto_rate_30d` | carrier_performance_metrics |
| `carrier_avg_nps_7d` | carrier_performance_metrics |
| `carrier_current_load_score` | carrier_performance_metrics |
| `route_tat_days` | tms_city_to_city_mappings |
| `destination_pincode_delay_index` | pincode_delay_index |
| `service_type_match` | Binary — does carrier support requested service type |
| `route_coverage_flag` | tms_shipper_freight_category_pincodes |
| `weight_category` | Order features |

**Performance gate before promotion:** NDCG@3 ≥ 0.75

---

### 10.3 SHAP Explainability

Both models use `shap.TreeExplainer` — the same API works for XGBoost and LightGBM.

For each prediction:
- SHAP values are computed alongside inference (adds ~2–3ms)
- Top 5 feature contributions stored in `ml_predictions.input_features`
- Full SHAP vector available via `GET /predict/{prediction_id}/explain`
- Frontend SHAP panel shows: feature name, value at prediction time, contribution direction (increasing or decreasing risk), magnitude

This is what operations teams use to answer "why is this shipment flagged?" — not just a score.

---

### 10.4 Shadow Mode Deployment

When a new model version is trained and passes the performance gate:

```
State: shadow_active = true in ML Serving config

On every inference request:
  1. Run current PRODUCTION model → return result to caller
  2. Run SHADOW model → log result to ml_predictions with tag {shadow: true}
  3. Do NOT use shadow result for any action

After 48 hours:
  Compare: production model accuracy vs shadow model accuracy
  on the same set of shipments that have since been delivered.

  If shadow is better → promote shadow to production in MLflow
  If shadow is worse  → discard shadow, keep production, log finding to Grafana
```

---

### 10.5 Drift Monitoring

A daily monitoring job queries `ml_predictions`:
- Compute rolling 7-day accuracy: `was_correct` rate
- Compute score distribution (histogram of risk_score values)
- Compare against baseline established at last training

If 7-day accuracy drops more than 5 percentage points below baseline → fire Grafana alert → trigger retraining pipeline.

---

## 11. Observability Architecture

### Three Pillars

**Logs — Structured JSON**

Every service uses a structured logger:
- Node.js: `pino`
- Go: `zap`
- Python: `structlog`

Every log line contains:
```json
{
  "timestamp": "2026-05-23T10:00:00.123Z",
  "level": "info",
  "service": "order-service",
  "correlation_id": "abc-123",
  "trace_id": "0af7651916cd43dd8448eb211c80319c",
  "span_id": "b7ad6b7169203331",
  "message": "order created successfully",
  "awb_number": "RS123456789IN",
  "duration_ms": 12
}
```

`correlation_id` is generated at the Gateway and passed as an HTTP header (`X-Correlation-ID`) to all downstream services. Every service must forward it.

---

**Metrics — Prometheus**

Every service exposes `GET /metrics` in Prometheus format.

Standard metrics per service:
- `http_requests_total` (by route, status code)
- `http_request_duration_ms` (histogram — p50, p95, p99)
- `kafka_consumer_lag` (by topic, consumer group)
- `kafka_messages_processed_total` (by topic)

ML Serving additional metrics:
- `ml_prediction_duration_ms` (by model_name, cache_hit)
- `ml_cache_hit_rate` (Redis hit vs miss)
- `ml_prediction_score_distribution` (histogram of risk scores)
- `ml_model_accuracy_7d` (gauge — rolling accuracy)

Go services additional metrics:
- `worker_pool_queue_depth` (gauge — pending jobs in channel)
- `goroutine_count` (gauge)

Grafana dashboards:
1. System Overview — end-to-end request rate, error budget, Kafka lag
2. Per-service dashboards — latency, throughput, errors
3. ML Health — prediction accuracy, score drift, cache hit rate
4. Infrastructure — memory, CPU, pod count per service

---

**Traces — OpenTelemetry → Jaeger**

OpenTelemetry SDK instrumented in all 7 services.

A single request — from carrier webhook arriving to alert dispatched — produces one trace spanning:
```
Tracking Ingestion (Go)
  └── MongoDB write
  └── Kafka produce
      └── SLA Monitoring (Go) [Kafka consumer span]
          └── ML Serving (Python) [HTTP span]
              └── Redis get
              └── XGBoost inference
              └── MongoDB write (prediction log)
          └── Kafka produce (sla-alert)
              └── Alert Service (Node.js) [Kafka consumer span]
                  └── PostgreSQL read (alert rules)
                  └── Notification dispatch
```

Trace ID is passed as a Kafka header so the consumer span links to the producer span. This is what "distributed tracing" means — one unbroken trace across async boundaries.

---

## 12. Security Design

| Concern | Mechanism |
|---|---|
| Frontend authentication | JWT (RS256 — asymmetric keys). Public key in Gateway, private key in Auth Service or Clerk. |
| Carrier webhook authentication | HMAC-SHA256 signature on request body. Carrier secret stored in Kubernetes Secret. |
| Service-to-service (internal) | Shared API key in HTTP header (`X-Internal-API-Key`). Kubernetes Secret. Upgrade to mTLS post-v1. |
| Secrets management | All secrets in Kubernetes Secrets. Never in `.env` files committed to git. Never hardcoded. |
| Rate limiting | 100 requests/minute per seller on GraphQL Gateway. |
| Input validation | At every service boundary — not just at the Gateway. Reject malformed requests before they touch the database. |
| SQL injection | PostgreSQL queries use parameterized statements (no string interpolation). |
| Dependency scanning | GitHub Actions runs `npm audit`, `govulncheck`, `safety` (Python) on every PR. |

---

## 13. Scalability and Reliability

### Where the System Can Be Slow (and How We Prevent It)

| Bottleneck | Solution |
|---|---|
| Carrier webhook burst (10k events/min) | Go worker pool in Tracking Ingestion. HPA scales pods based on Kafka consumer lag. Return HTTP 200 before processing (async). |
| ML inference under prediction load | Redis feature cache eliminates MongoDB reads at inference time. HPA scales ML Serving on CPU utilization. XGBoost/LightGBM inference is CPU-bound — horizontal scaling is straightforward. |
| Kafka consumer lag in SLA Monitoring | HPA scales Go pods based on consumer lag metric (exposed to Prometheus via Kafka consumer group API). |
| MongoDB write throughput for tracking scans | Write to MongoDB with `w: 1` (acknowledge from primary only — not majority). Use MongoDB replica set with reads from secondaries for analytics queries. |
| nightly batch job duration | Partition batch job: run carrier metrics and pincode metrics in parallel. Write in bulk (not one document at a time). |

### How the System Fails Gracefully

| Failure | Behavior |
|---|---|
| ML Serving is down | Routing Service: circuit breaker opens → rule-based fallback. SLA Monitoring: logs warning, commits Kafka offset, skips prediction. System continues operating without ML — degraded, not dead. |
| MongoDB write fails in Tracking Ingestion | Kafka offset NOT committed. Message retried with exponential backoff. Worker logs error with trace_id for investigation. |
| Redis is down | ML Serving falls back to reading features from MongoDB directly. Latency increases from <10ms to ~40ms. Not acceptable long-term but survivable short-term. Redis restart expected within minutes. |
| Nightly batch job fails | Previous day's `carrier_performance_metrics` and `pincode_delay_index` are still valid. ML predictions continue using slightly stale features. Grafana alert fires. On-call investigates. |
| Kafka broker loss (1 of 3) | Kafka cluster continues with 2 brokers. Replication factor 2 ensures no data loss. System operates normally. |
| PostgreSQL is down | Routing Service: reads last routing decision from Redis fallback cache (5-minute TTL). Alert Service: alert rules cached in memory (refreshed every 5 minutes). |

### Kubernetes HPA Configuration

| Service | Scale Trigger | Min Pods | Max Pods |
|---|---|---|---|
| Tracking Ingestion | Kafka consumer lag > 1000 messages | 2 | 10 |
| SLA Monitoring | Kafka consumer lag > 500 messages | 2 | 8 |
| ML Serving | CPU utilization > 70% | 2 | 6 |
| GraphQL Gateway | Request rate > 500 req/min | 1 | 4 |
| Order/Routing/Alert | CPU utilization > 70% | 1 | 3 |

---

## 14. Architecture Decision Records

### ADR-001: MongoDB as Primary Store — No PostgreSQL Migration

**Context:** The existing Logistics production data — shipments, tracking events, carrier configurations, pincodes — is entirely in MongoDB. The original project plan assumed PostgreSQL as the primary transactional store.

**Decision:** Keep MongoDB as the primary store. Do not migrate existing data to PostgreSQL.

**Alternatives considered:**
- Full migration to PostgreSQL: rejected. Would require migrating 10+ collections, rebuilding all existing queries, and adds months of work with no ML benefit. The document model of MongoDB is actually well-suited to tracking scan arrays (variable-length, embedded).
- Dual-write (MongoDB + PostgreSQL) for all entities: rejected. Introduces consistency risk — what if one write succeeds and the other fails? Adds complexity with no clear benefit for entities already in MongoDB.

**Consequence:** PostgreSQL is introduced only for `routing_decisions` and `sla_alert_rules` — net-new entities that do not exist in the current schema.

---

### ADR-002: PostgreSQL for routing_decisions and sla_alert_rules

**Context:** Two new entities need to be created as part of this system.

**Decision:** These two entities go in PostgreSQL, not MongoDB.

**Why these two specifically:**
- `routing_decisions`: An audit log. Every routing decision must be reliably queryable by order_id. Relational queries (join routing decision to seller to carrier) are cleaner in SQL. ACID guarantees mean a routing decision write either fully commits or rolls back — no partial documents.
- `sla_alert_rules`: Alert rules have foreign key relationships (seller_id → sellers, carrier rules). Enforcing referential integrity in MongoDB requires application-level checks. PostgreSQL handles it structurally.

**Consequence:** The system requires two database connections in Routing Service and Alert Service. This is a real engineering tradeoff — justified by the relational nature of these entities.

---

### ADR-003: Go for Tracking Ingestion and SLA Monitoring

**Context:** These two services have the highest throughput requirements in the system.

**Decision:** Implement in Go. All other services remain in Node.js/TypeScript.

**Why Go for these two:**
- Tracking Ingestion must handle 10,000+ webhook events/minute. Go's goroutines are lightweight (2KB stack vs 1MB for OS threads). A worker pool of 50 goroutines handles concurrent I/O with minimal memory overhead.
- SLA Monitoring processes every Kafka message with a synchronous ML call. Go's `context` package provides clean timeout propagation and cancellation across goroutines — critical when ML Serving is slow.
- Go produces a statically-linked binary — the Docker image for these services is smaller and starts faster than equivalent Node.js images.

**Learning note:** Go is new for the developer. Strategy: build all Node.js services first (Phase 2), understand the full architecture, then tackle Go services (Phase 3) as bounded, well-understood problems.

---

### ADR-004: Kafka over Direct HTTP Between Services

**Context:** Services need to communicate. The simplest approach is direct HTTP calls.

**Decision:** Use Kafka for all inter-service communication except where synchronous response is required (ML Serving calls, Gateway → Service calls).

**Why Kafka for async flows:**
- Temporal decoupling: Order Service does not need to wait for Routing Service to be available. It publishes and moves on.
- Replay: If SLA Monitoring crashes, Kafka retains messages. When it recovers, it processes from where it left off — no events are lost.
- Fan-out: A single `ORDER_CREATED` event can be consumed by multiple services (Routing Service, analytics pipeline) without Order Service knowing about all consumers.

**Where HTTP is still used (synchronous):**
- Gateway → Services: the Frontend is waiting for a response. Must be synchronous.
- Routing Service → ML Serving: carrier selection blocks the routing decision. Must be synchronous (but circuit-breaker protected).
- SLA Monitoring → ML Serving: prediction is time-sensitive but failure is tolerated (log and continue).

---

### ADR-005: Redis for Feature Caching at ML Inference Time

**Context:** ML Serving needs carrier performance metrics and pincode delay index to compute predictions. These live in MongoDB.

**Decision:** Pre-populate Redis with features for all active shipments nightly. ML Serving reads from Redis first, falls back to MongoDB.

**Why not read MongoDB directly:**
- MongoDB read for a joined feature set (carrier metrics + pincode index + shipment details) takes 30–60ms. At p99 this becomes the dominant latency in the prediction path.
- Redis with the right key pattern reduces this to <2ms, making the p99 prediction latency under 10ms achievable.

**Tradeoff:** Features are at most 6 hours stale. For a nightly-computed metric like carrier SLA rate, 6 hours of staleness is acceptable. For real-time carrier load, the nightly job computes load score from shipment counts — also acceptable.

---

### ADR-006: XGBoost for SLA Breach Prediction (not Neural Networks)

**Context:** The SLA breach predictor is a binary classification problem.

**Decision:** Use XGBoost, not a neural network.

**Why:**
- The feature set is tabular (structured data). XGBoost consistently outperforms neural networks on tabular data at this feature count.
- XGBoost is compatible with `shap.TreeExplainer` — SHAP values are computed in linear time (not approximated). This is how we get per-prediction explanations that are fast enough to serve in real-time.
- Training time is seconds to minutes, not hours. Retraining weekly is practical.
- Neural networks would require feature normalization, learning rate tuning, architecture search — all adding complexity without demonstrated accuracy benefit for this problem type.

---

### ADR-007: SHAP for Model Explainability

**Context:** Operations teams and sellers need to understand why a shipment is flagged as high risk. A score alone is not actionable.

**Decision:** Compute SHAP values for every SLA breach prediction. Store top 5 contributors in `ml_predictions`. Expose full SHAP vector via API.

**Why SHAP and not LIME or feature importance:**
- SHAP values are theoretically grounded (game theory — Shapley values). Each feature gets a contribution that fairly reflects its role in this specific prediction.
- `shap.TreeExplainer` is optimized for tree-based models. For XGBoost, it runs in O(TLD) time (T trees, L leaves, D depth) — fast enough for real-time serving.
- Feature importance (from XGBoost natively) is global — it tells you which features matter across all predictions, not for this specific shipment. SHAP is per-prediction.

---

### ADR-008: Shadow Mode for Model Deployment

**Context:** When a new model version is trained, we need confidence it performs better before replacing the current production model.

**Decision:** New models run in shadow mode for 48 hours before promotion. During shadow mode, the current production model's results are used for all actions. The shadow model runs on every request and logs its results — but takes no action.

**Why 48 hours:**
- Enough to accumulate predictions with outcomes. Shipments delivered within 48 hours provide ground truth labels.
- Short enough that a clearly better model is not delayed unnecessarily.

**Promotion criteria:** Shadow model accuracy (on shipments with outcomes within the 48h window) must be ≥ production model accuracy on the same shipments.

---

## 15. Open Questions

| Question | Owner | Target Resolution |
|---|---|---|
| What is the carrier webhook authentication mechanism for each carrier? (HMAC? IP whitelist? API key?) | Platform | Before Phase 2 |
| What is the external notification channel for seller alerts in v1? (Email only? Webhook?) | Product | Before Phase 5 |
| What is the retraining trigger threshold for drift? (Accuracy drops by X points?) | ML | Before Phase 4 |
| Should `model-feedback` topic be produced by Order Service (on delivery) or by the nightly batch job? | Engineering | Before Phase 4 |
| Weather risk score data source for v2. | Engineering | Post-v1 |

---

*End of HLD v1.0*

*Next step: Low-Level Design (LLD) per service, starting with Order Service and Routing Service.*
