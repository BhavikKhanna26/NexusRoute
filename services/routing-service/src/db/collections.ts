// MongoDB collection constants — same reasoning as topic constants.
// The routing service only reads from the logistics cluster.

export const COLLECTIONS = {
  // Logistics cluster — read only
  MST_PINCODES:      'mst_pincodes',
  TMS_CITY_MAPPINGS: 'tms_city_to_city_shipper_category_mappings',
} as const;
