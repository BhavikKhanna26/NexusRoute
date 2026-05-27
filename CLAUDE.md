# NexusRoute — Claude Context

## How to work with Bhavik

- **Bhavik runs every command himself.** Write the command + explain why, never execute it.
- **Faster pace.** Concept + code + reasoning in one response. Don't break a topic across multiple turns with questions in between.
- **No "RapidShyp" anywhere in the codebase** — licensing issue. Use `Logistics` / `logistics` / `LOGISTICS` everywhere. This rule applies to every future file, comment, and variable name.
- README.md updates with every completed service — tick the phase checklist, add key decisions to the table.

---

## What This Project Is

AI-Powered Predictive SLA Breach & Smart Carrier Routing Platform, built on top of an existing logistics company's MongoDB database.

Two ML capabilities:
1. **SLA Breach Predictor** (XGBoost) — scores every shipment on every tracking scan (0–1). Fires alert before breach happens.
2. **Smart Carrier Ranker** (LightGBM/LambdaRank) — at order creation, ranks carriers by real 7d/30d route performance.

Full architecture, ADRs, and NFRs are in [HLD.md](HLD.md).

---

## Database Setup — Critical

Two MongoDB Atlas clusters. Never mix them.

| Env var | Cluster | Access | Used for |
|---|---|---|---|
| `LOGISTICS_MONGODB_URI` + `LOGISTICS_MONGODB_DB` | Existing logistics org cluster | **READ ONLY** | oms_shipments, tms_*, mst_* collections |
| `NEXUSROUTE_MONGODB_URI` + `NEXUSROUTE_MONGODB_DB` | Bhavik's personal Atlas cluster | Read + Write | All new collections + new orders |

In code: `getLogisticsDb()` → read only. `getNexusrouteDb()` → read/write.
DB name is always resolved from env var, never embedded in the URI or hardcoded.

---

## Infrastructure (Phase 1 — COMPLETE)

All running locally via Docker Compose.

```bash
docker-compose up -d   # starts Kafka + Zookeeper, Redis, PostgreSQL
                       # MongoDB is NOT in Docker — both clusters are Atlas
```

### Kafka Topics (all created by kafka/init-topics.sh)

| Topic | Partitions | Key | Retention |
|---|---|---|---|
| `order-events` | 3 | `seller_id` | 7d |
| `tracking-updates` | 6 | `awb_number` | 7d |
| `sla-alerts` | 3 | `seller_id` | 7d |
| `routing-decisions` | 3 | `order_id` | 7d |
| `model-feedback` | 3 | `awb_number` | 30d |

`tracking-updates` has 6 partitions — highest volume topic (10k events/min). Partition count = max consumer parallelism ceiling.

### MongoDB Collections (new — on NEXUSROUTE cluster)
Initialised via `mongo/init.js` run against NEXUSROUTE_MONGODB_URI.
- `shipment_sla_events` — ML training dataset, one doc per shipment
- `carrier_performance_metrics` — rolling 7d/30d carrier stats, written by nightly batch
- `pincode_delay_index` — delay rate per destination pincode
- `ml_predictions` — every inference logged, used for drift monitoring

### PostgreSQL Tables (in Docker)
Initialised via `postgres/init.sql`.
- `routing_decisions` — immutable audit log of every carrier selection
- `sla_alert_rules` — per-seller alert config (threshold + channels)

---

## Config Pattern (established in Order Service — apply to every future service)

**Split config by domain, load dotenv via -r flag, never in TypeScript:**

```
src/config/
  app.ts      → PORT, NODE_ENV, INTERNAL_API_KEY
  mongo.ts    → LOGISTICS_MONGODB_URI/DB + NEXUSROUTE_MONGODB_URI/DB
  kafka.ts    → KAFKA_BOOTSTRAP_SERVERS → { brokers, clientId }
  index.ts    → re-exports only, no dotenv
```

In `package.json` dev script:
```
cross-env DOTENV_CONFIG_PATH=../../.env ts-node-dev -r dotenv/config --respawn --transpile-only src/index.ts
```

**Structural config (topic names, collection names) are hardcoded constants, never in .env:**
- `src/kafka/topics.ts` — TOPICS object + CONSUMER_GROUPS object
- `src/db/collections.ts` — COLLECTIONS object

---

## Shared Contracts Package

`packages/contracts/src/kafka/events.ts` — single source of truth for all Kafka message schemas.
Every service imports event types from `@nexusroute/contracts`.
Build before running any service: `npm run build --workspace=packages/contracts`

Event types defined: `OrderCreatedEvent`, `RoutingDecidedEvent`, `TrackingUpdateEvent`, `SlaAlertEvent`, `ModelFeedbackEvent`

---

## Phase 2 — Services Status

### Order Service — COMPLETE ✓
**Port:** 3001 | **Path:** `services/order-service/`

What it does:
- `POST /orders` → validates with Zod → writes to `oms_shipments` (NEXUSROUTE) → publishes `ORDER_CREATED` to `order-events` Kafka topic → returns `{order_id, awb_number, status: "PENDING"}`
- Consumes `routing-decisions` topic → when `ROUTING_DECIDED` arrives, updates order to `CARRIER_ASSIGNED`
- `PATCH /orders/:id/status` → enforces state machine (rejects invalid transitions with 422)

Key patterns used:
- **State machine as transition table** (`src/domain/order.statemachine.ts`) — not if-chains
- **Idempotent Kafka producer** — `idempotent: true`, broker-side dedup via sequence numbers
- **Compare-and-set consumer** — filter `{ status: 'PENDING' }` in updateOne makes ROUTING_DECIDED handler idempotent without Redis
- **Fail-fast config** — Zod schema on all env vars, process.exit(1) if anything missing
- **Graceful shutdown** — server.close() drains requests before disconnecting Kafka + MongoDB

To run: `npm run order-service` (from repo root)

---

### Routing Service — NEXT TO BUILD
**Port:** 3002 | **Path:** `services/routing-service/` (not created yet)

What it must do:
1. Consume `order-events` topic (`ORDER_CREATED` events) — consumer group: `routing-service`
2. Call ML Serving `POST /rank/carriers` synchronously (with **circuit breaker**, 200ms timeout)
3. Apply serviceability rules on top of ML ranking
4. Write routing decision to PostgreSQL `routing_decisions`
5. Publish `ROUTING_DECIDED` to `routing-decisions` Kafka topic

**Two strategies — Strategy Pattern:**
- `MLRankingStrategy` — calls ML Serving, returns LightGBM-ranked carrier
- `RuleBasedStrategy` — fallback when circuit breaker is open, reads static scores from logistics DB

**Circuit breaker config:**
- Timeout: 200ms per ML Serving call
- Open after: 5 consecutive failures
- Recovery attempt: every 30 seconds
- On open → switch to `RuleBasedStrategy`, set `decision_reason = 'RULE_FALLBACK'`

**PostgreSQL write** — `routing_decisions` table (see postgres/init.sql for schema).

Industry problems to cover when building this service:
- Circuit breaker state machine (CLOSED → OPEN → HALF_OPEN → CLOSED)
- What happens when PostgreSQL write succeeds but Kafka publish fails (outbox pattern consideration)
- ACID guarantee on routing_decisions

---

### Alert Service — PENDING
**Port:** 3003 | **Path:** `services/alert-service/` (not created yet)

What it must do:
1. Consume `sla-alerts` topic — consumer group: `alert-service`
2. Read seller-specific alert rules from PostgreSQL `sla_alert_rules`
3. Dispatch notifications (email/webhook) based on rules
4. REST API: CRUD for alert rules + list/acknowledge/resolve alerts

---

### GraphQL Gateway — PENDING
**Port:** 3000 | **Path:** `services/graphql-gateway/` (not created yet)

What it must do:
- Single entry point for the Next.js frontend
- JWT validation (RS256) on every request
- Rate limiting: 100 req/min per seller
- Compose data from Order, Routing, Alert services
- Forward `X-Correlation-ID` and trace context to downstream services
- DataLoader pattern to prevent N+1 queries

Industry problems to cover: JWT RS256 vs HS256, DataLoader mechanics, rate limiting algorithms (token bucket vs fixed window)

---

## Full Phase Plan

| Phase | Status | What |
|---|---|---|
| Phase 1 | ✅ Done | Infrastructure: Kafka, MongoDB, Redis, PostgreSQL, Docker Compose |
| Phase 2 | 🔄 In Progress | Node.js services: Order ✅, Routing ⬜, Alert ⬜, Gateway ⬜ |
| Phase 3 | ⬜ Pending | Go services: Tracking Ingestion (port 8080), SLA Monitoring (internal) |
| Phase 4 | ⬜ Pending | ML Serving: FastAPI, XGBoost, LightGBM, SHAP, shadow mode deployment |
| Phase 5 | ⬜ Pending | ML Platform: nightly batch pipeline, drift monitoring, retraining |

---

## Project Structure (current)

```
NexusRoute/
├── CLAUDE.md                   ← this file
├── HLD.md                      ← full system design + ADRs
├── README.md                   ← developer setup guide
├── docker-compose.yml          ← Kafka + Redis + PostgreSQL (no MongoDB)
├── .env.example                ← template, copy to .env and fill in Atlas URIs
├── .gitignore
├── package.json                ← npm workspaces root
│
├── kafka/
│   └── init-topics.sh          ← creates 5 topics on startup
├── mongo/
│   └── init.js                 ← run once against NEXUSROUTE Atlas cluster
├── postgres/
│   └── init.sql                ← routing_decisions + sla_alert_rules
│
├── packages/
│   └── contracts/              ← @nexusroute/contracts
│       └── src/kafka/events.ts ← all Kafka event type interfaces
│
└── services/
    ├── order-service/          ← COMPLETE — port 3001
    │   └── src/
    │       ├── config/         ← app.ts, mongo.ts, kafka.ts, index.ts
    │       ├── db/             ← mongo.ts (two clients), collections.ts
    │       ├── kafka/          ← producer.ts, consumer.ts, topics.ts
    │       ├── domain/         ← order.statemachine.ts
    │       ├── routes/         ← orders.ts
    │       ├── logger.ts
    │       └── index.ts
    ├── routing-service/        ← NOT CREATED YET — next
    ├── alert-service/          ← NOT CREATED YET
    └── graphql-gateway/        ← NOT CREATED YET
```

---

## Commands Reference

```bash
# Start infrastructure
docker-compose up -d

# Verify Kafka topics
docker exec nexusroute-kafka kafka-topics --bootstrap-server localhost:9092 --list

# Init MongoDB collections (run once)
mongosh "$NEXUSROUTE_MONGODB_URI/$NEXUSROUTE_MONGODB_DB" --file mongo/init.js

# Install all packages
npm install

# Build contracts (required before running any service)
npm run build --workspace=packages/contracts

# Run services
npm run order-service      # port 3001
npm run routing-service    # port 3002 — not built yet
npm run alert-service      # port 3003 — not built yet
npm run gateway            # port 3000 — not built yet
```
