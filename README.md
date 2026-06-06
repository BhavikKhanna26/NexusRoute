# NexusRoute

AI-Powered Predictive SLA Breach & Smart Carrier Routing Platform.

Built on top of the top-end logistics data. Adds two ML-powered capabilities:

- **SLA Breach Predictor** (XGBoost) — scores every shipment on every tracking scan. Fires an alert before the customer knows anything is wrong.
- **Smart Carrier Ranker** (LightGBM/LambdaRank) — at order creation, ranks carriers by real route performance over the last 7 and 30 days.

---

## Architecture

```
Carrier webhooks ──► Tracking Ingestion (Go :8080)
                            │ Kafka: tracking-updates
                            ▼
Seller browser ──────► GraphQL Gateway (Node :3000)
                            │
                 ┌──────────┼──────────┐
                 ▼          ▼          ▼
          Order Svc   Routing Svc  Alert Svc
          (Node :3001) (Node :3002) (Node :3003)
                 │          │
                 └────► ML Serving (Python :8000)
                              │
                         Redis cache

Event bus: Apache Kafka (5 topics)
Primary DB: MongoDB Atlas (Logistics Data read + NexusRoute write)
Relational: PostgreSQL (routing_decisions, sla_alert_rules)
Cache: Redis (ML feature cache, TTL 6h)
ML Platform: MLflow (model registry + experiments)
Observability: OpenTelemetry → Jaeger, Prometheus → Grafana
```

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | 20+ | All Node.js services |
| npm | 10+ | Package manager (workspaces) |
| Go | 1.22+ | Tracking Ingestion, SLA Monitoring |
| Python | 3.11+ | ML Serving, batch pipeline |
| Docker + Compose | Latest | Local Kafka, Redis, PostgreSQL |
| mongosh | Latest | MongoDB Atlas init script |

---

## Local Setup

### 1. Clone and install

```bash
git clone <repo>
cd NexusRoute
npm install
```

### 2. Environment

```bash
cp .env.example .env
# Fill in LOGISTICS_DATA_MONGODB_URI, LOGISTICS_DATA_MONGODB_DB,
#          NEXUSROUTE_MONGODB_URI, NEXUSROUTE_MONGODB_DB
# Leave all Docker service values as-is
```

### 3. Start infrastructure

```bash
docker-compose up -d
```

Verify topics were created:
```bash
docker exec nexusroute-kafka kafka-topics --bootstrap-server localhost:9092 --list
```

### 4. Initialize MongoDB collections

```bash
mongosh "$NEXUSROUTE_MONGODB_URI/$NEXUSROUTE_MONGODB_DB" --file mongo/init.js
```

### 5. Build shared contracts package

```bash
npm run build --workspace=packages/contracts
```

---

## Running Services

Each service runs independently. Start from the repo root:

```bash
# Order Service (port 3001)
npm run order-service

# Routing Service (port 3002)
npm run routing-service

# Alert Service (port 3003) — Phase 2 in progress
npm run alert-service

# GraphQL Gateway (port 3000) — Phase 2 in progress
npm run gateway
```

Health check any service:
```bash
curl http://localhost:3001/health
```

---

## Project Structure

```
NexusRoute/
├── docker-compose.yml          Infrastructure: Kafka, Redis, PostgreSQL
├── .env.example                Environment variable template
│
├── packages/
│   └── contracts/              Shared Kafka event types (imported by all services)
│       └── src/kafka/events.ts OrderCreatedEvent, RoutingDecidedEvent, ...
│
├── services/
│   ├── order-service/          Node.js + TypeScript — port 3001 ✓
│   │   └── src/
│   │       ├── config/         app.ts · mongo.ts · kafka.ts · index.ts
│   │       ├── db/             mongo.ts (two clients) · collections.ts
│   │       ├── kafka/          producer.ts · consumer.ts · topics.ts
│   │       ├── domain/         order.statemachine.ts
│   │       └── routes/         orders.ts
│   ├── routing-service/        Node.js + TypeScript — port 3002 ✓
│   │   └── src/
│   │       ├── config/         app.ts · mongo.ts · kafka.ts · postgres.ts · index.ts
│   │       ├── db/             mongo.ts (logistics only) · postgres.ts · collections.ts
│   │       ├── kafka/          producer.ts · consumer.ts · topics.ts
│   │       ├── circuit-breaker/ circuit-breaker.ts
│   │       ├── strategies/     types.ts · ml-ranking.strategy.ts · rule-based.strategy.ts
│   │       ├── routes/         routing.ts
│   │       └── routing-handler.ts
│   ├── alert-service/          Node.js + TypeScript — port 3003 ✓
│   ├── graphql-gateway/        Node.js + TypeScript — port 3000 (pending)
│   ├── tracking-ingestion/     Go — port 8080 (pending)
│   ├── sla-monitoring/         Go — internal (pending)
│   └── ml-serving/             Python + FastAPI — port 8000 (pending)
│
├── kafka/
│   └── init-topics.sh          Topic creation (5 topics, partition + retention config)
├── mongo/
│   └── init.js                 New MongoDB collections + indexes
└── postgres/
    └── init.sql                routing_decisions + sla_alert_rules tables
```

---

## Kafka Topics

| Topic | Partitions | Key | Retention | Flow |
|---|---|---|---|---|
| `order-events` | 3 | `seller_id` | 7d | Order Svc → Routing Svc |
| `tracking-updates` | 6 | `awb_number` | 7d | Tracking Ingestion → SLA Monitoring |
| `sla-alerts` | 3 | `seller_id` | 7d | SLA Monitoring → Alert Svc |
| `routing-decisions` | 3 | `order_id` | 7d | Routing Svc → Order Svc |
| `model-feedback` | 3 | `awb_number` | 30d | Order Svc → ML pipeline |

`tracking-updates` has 6 partitions (vs 3 for others) because it carries the highest volume — 10k events/min peak. Partition count = max consumer parallelism.

---

## MongoDB Collections

| Collection | Cluster | Purpose |
|---|---|---|
| `oms_shipments` | NexusRoute (rw) | Orders created by this system |
| `shipment_sla_events` | NexusRoute (rw) | ML training dataset — one doc per shipment |
| `carrier_performance_metrics` | NexusRoute (rw) | Rolling 7d/30d stats, written by nightly batch |
| `pincode_delay_index` | NexusRoute (rw) | Delay rate per destination pincode |
| `ml_predictions` | NexusRoute (rw) | Every inference logged — drift monitoring |
| `oms_shipments`, `tms_*`, `mst_*` | Existing production data — read only |

---

## Phase Progress

- [x] **Phase 1** — Infrastructure: Kafka, MongoDB, Redis, PostgreSQL, Docker Compose
- [x] **Phase 2** — Core Services: Order, Routing, Alert, GraphQL Gateway
  - [x] Order Service — state machine, Kafka producer/consumer, REST API
  - [x] Routing Service — circuit breaker, ML call, PostgreSQL write
  - [x] Alert Service — rule evaluation, notification dispatch
  - [x] GraphQL Gateway — JWT RS256, token bucket rate limiting, DataLoader
- [ ] **Phase 3** — Go Services: Tracking Ingestion, SLA Monitoring
- [ ] **Phase 4** — ML Serving: FastAPI, XGBoost, LightGBM, SHAP, shadow mode
- [ ] **Phase 5** — ML Platform: nightly batch, drift monitoring, retraining pipeline

---

## Key Design Decisions

See [HLD.md](HLD.md) for full Architecture Decision Records (ADR-001 through ADR-008).

| Decision | Choice | Why |
|---|---|---|
| Primary DB | MongoDB Atlas | Existing Logistics Database schema — document model fits variable scan events |
| New relational data | PostgreSQL | `routing_decisions` and `sla_alert_rules` need ACID + referential integrity |
| ML feature cache | Redis (TTL 6h) | MongoDB join at inference time = 30–60ms. Redis = <2ms |
| Async communication | Kafka | Temporal decoupling, replay on consumer crash, fan-out |
| SLA predictor | XGBoost | Tabular data, SHAP-compatible, retrains in minutes |
| Carrier ranker | LightGBM LambdaRank | Learning-to-rank objective matches the "sort carriers" problem |
| Go for ingestion | goroutines | 10k webhooks/min — Go worker pool handles this with 2KB/goroutine overhead |
| Routing circuit breaker | Hand-rolled state machine | CLOSED→OPEN→HALF_OPEN. 5 failures → OPEN, 30s → HALF_OPEN probe. Config from env vars |
| Routing fallback | Strategy pattern | `MLRankingStrategy` and `RuleBasedStrategy` share one interface — swapped at runtime, no if-chains in handler |
| Routing idempotency | PostgreSQL dedup | Check `routing_decisions WHERE order_id` before processing — handles Kafka at-least-once redelivery without Redis |
| PostgreSQL + Kafka atomicity | Log, don't rethrow | PG write succeeds, Kafka publish fails → order stuck in PENDING. Logged with all IDs for manual recovery. Rethrowing causes infinite skip loop. Outbox pattern is Phase 3+ |
| Alert storage | Store before dispatch | Alert persisted to PostgreSQL before any notification attempt — never lost even if all channels fail |
| Alert notifications | Isolated per-channel try/catch | One webhook failure does not block email or other channels on the same rule |
| Alert rules | Per-seller thresholds | Each rule has its own `risk_threshold` — email at 0.65, PagerDuty webhook at 0.85 for same seller |
| alerts table idempotency | UNIQUE + pre-check | Kafka at-least-once cannot produce duplicate alert rows; explicit check gives clean log over PG constraint error |
