// Order lifecycle state machine.
//
// The table-driven approach means adding a new state (e.g. LOST) is one line here.
// An if-else chain would require touching every existing branch.
// More importantly: the valid transitions are visible at a glance — no need to read
// through branching logic to understand what moves are legal.

export type OrderStatus =
  | 'PENDING'
  | 'CARRIER_ASSIGNED'
  | 'PICKUP_SCHEDULED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'NDR'
  | 'RTO_INITIATED'
  | 'RTO_DELIVERED';

// Record<current, allowed next states>
// An empty array means terminal state — no further transitions allowed.
const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING:           ['CARRIER_ASSIGNED'],
  CARRIER_ASSIGNED:  ['PICKUP_SCHEDULED'],
  PICKUP_SCHEDULED:  ['IN_TRANSIT'],
  IN_TRANSIT:        ['DELIVERED', 'NDR'],
  NDR:               ['IN_TRANSIT', 'RTO_INITIATED'], // retry delivery OR start return
  RTO_INITIATED:     ['RTO_DELIVERED'],
  DELIVERED:         [],
  RTO_DELIVERED:     [],
};

export class InvalidTransitionError extends Error {
  constructor(from: OrderStatus, to: OrderStatus) {
    super(`Invalid order status transition: ${from} → ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertValidTransition(from: OrderStatus, to: OrderStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function isTerminalState(status: OrderStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}
