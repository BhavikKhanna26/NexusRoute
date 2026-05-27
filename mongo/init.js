// MongoDB initialization script — run against your personal Atlas cluster.
//
// NEVER run this against the Logistics production URI.
// This creates 4 new collections that do not exist in the Logistics schema.
//
// How to run (bash):
//   mongosh "$NEXUSROUTE_MONGODB_URI/$NEXUSROUTE_MONGODB_DB" --file mongo/init.js
//
// How to run (PowerShell):
//   mongosh "$env:NEXUSROUTE_MONGODB_URI/$env:NEXUSROUTE_MONGODB_DB" --file mongo/init.js
//
// The database name is appended to the URI so mongosh selects it on connect.
// `db` below refers to that database — no getSiblingDB needed.

// ═══════════════════════════════════════════════════════════════════════════════
// 1. shipment_sla_events
// ───────────────────────────────────────────────────────────────────────────────
// One document per shipment. Contains:
//   - all ML features snapshotted at prediction time
//   - ground truth label (sla_breached) set when shipment delivers
//
// This is the training dataset. Every retrain reads from this collection.
// ═══════════════════════════════════════════════════════════════════════════════
db.createCollection('shipment_sla_events');

// awb_number is the primary lookup key — must be unique.
db.shipment_sla_events.createIndex(
  { awb_number: 1 },
  { unique: true, name: 'idx_awb_unique' }
);

// Used by the retraining pipeline: "give me all breached shipments for carrier X
// in the last 90 days". Compound index — field order matters.
// carrier_code first because it has higher cardinality than sla_breached (boolean).
// A high-cardinality prefix narrows the scan faster.
db.shipment_sla_events.createIndex(
  { carrier_code: 1, sla_breached: 1, created_at: -1 },
  { name: 'idx_carrier_breach_date' }
);

// Used by the pincode heatmap on the frontend and routing queries.
db.shipment_sla_events.createIndex(
  { destination_pincode: 1, created_at: -1 },
  { name: 'idx_pincode_date' }
);

// ═══════════════════════════════════════════════════════════════════════════════
// 2. carrier_performance_metrics
// ───────────────────────────────────────────────────────────────────────────────
// Written by nightly batch job. Rolling aggregated stats per carrier per route
// per time window (7d and 30d).
//
// These are the ML features for the carrier ranker.
// ═══════════════════════════════════════════════════════════════════════════════
db.createCollection('carrier_performance_metrics');

// Unique constraint on the natural key: one document per carrier+route+window+date.
// The batch job does upsert on this key — no duplicates.
db.carrier_performance_metrics.createIndex(
  { carrier_code: 1, origin_city: 1, destination_city: 1, window_days: 1, window_end_date: -1 },
  { unique: true, name: 'idx_carrier_route_window_unique' }
);

// Used by the purge job: delete records older than 90 days.
// Without this index, purge scans the entire collection.
db.carrier_performance_metrics.createIndex(
  { window_end_date: 1 },
  { name: 'idx_window_end_for_purge' }
);

// ═══════════════════════════════════════════════════════════════════════════════
// 3. pincode_delay_index
// ───────────────────────────────────────────────────────────────────────────────
// Quantitative delay score per destination pincode.
// Replaces the binary active-flag in tms_shipper_freight_category_delay_pincodes
// with a continuous score (0.0–1.0) based on historical breach rate.
// ═══════════════════════════════════════════════════════════════════════════════
db.createCollection('pincode_delay_index');

db.pincode_delay_index.createIndex(
  { pincode: 1, window_days: 1, window_end_date: -1 },
  { unique: true, name: 'idx_pincode_window_unique' }
);

// Used by routing: find high-delay pincodes so the ranker can penalize carriers
// with poor route coverage there. Range query: { delay_rate: { $gte: 0.3 } }
db.pincode_delay_index.createIndex(
  { delay_rate: 1 },
  { name: 'idx_delay_rate' }
);

// ═══════════════════════════════════════════════════════════════════════════════
// 4. ml_predictions
// ───────────────────────────────────────────────────────────────────────────────
// Immutable log of every inference call.
// Two uses:
//   a) Drift monitoring: query rolling 7-day accuracy (was_correct rate)
//   b) Explainability: fetch SHAP values for a past prediction by prediction_id
//
// This collection grows unbounded — plan a TTL index or archival strategy at scale.
// ═══════════════════════════════════════════════════════════════════════════════
db.createCollection('ml_predictions');

db.ml_predictions.createIndex(
  { prediction_id: 1 },
  { unique: true, name: 'idx_prediction_id_unique' }
);

// Alert Service and frontend: "show me all predictions for shipment X"
db.ml_predictions.createIndex(
  { awb_number: 1 },
  { name: 'idx_awb' }
);

// Drift monitoring: "compare accuracy of v1.2.0 vs v1.3.0 over the last 7 days"
db.ml_predictions.createIndex(
  { model_version: 1, predicted_at: -1 },
  { name: 'idx_model_version_date' }
);

// Drift monitoring: rolling accuracy query.
// was_correct is set to true/false when the shipment delivers (outcome known).
// null = outcome not yet recorded (shipment still in transit).
db.ml_predictions.createIndex(
  { was_correct: 1, predicted_at: -1 },
  { name: 'idx_correctness_date' }
);

print('==> nexusroute MongoDB collections and indexes created successfully.');
