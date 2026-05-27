// MongoDB collection name constants — same reasoning as Kafka topic constants.
// Collection names don't change per environment. Hardcode them here,
// import them everywhere. A typo becomes a compile-time or grep-time catch,
// not a silent "collection not found" at runtime.

export const COLLECTIONS = {
  // On NEXUSROUTE cluster (read + write)
  OMS_SHIPMENTS:               'oms_shipments',
  SHIPMENT_SLA_EVENTS:         'shipment_sla_events',
  CARRIER_PERFORMANCE_METRICS: 'carrier_performance_metrics',
  PINCODE_DELAY_INDEX:         'pincode_delay_index',
  ML_PREDICTIONS:              'ml_predictions',

  // On LOGISTICS cluster (read only)
  OMS_SHIPMENT_TRACKING:       'oms_shipment_tracking',
  TMS_CITY_MAPPINGS:           'tms_city_to_city_shipper_category_mappings',
  TMS_DELAY_PINCODES:          'tms_shipper_freight_category_delay_pincodes',
  MST_PINCODES:                'mst_pincodes',
  MST_HOLIDAY_CALENDAR:        'mst_holiday_calendar',
} as const;
