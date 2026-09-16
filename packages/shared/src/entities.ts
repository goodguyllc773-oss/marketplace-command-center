export const INVENTORY_STATUSES = [
  "INVENTORY",
  "LISTED",
  "RESERVED",
  "SOLD",
  "PAID",
  "SHIPPED",
  "DELIVERED",
  "RETURNED",
  "REFUNDED",
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const LISTING_STATUSES = [
  "DRAFT",
  "ACTIVE",
  "SOLD",
  "REMOVED",
  "NEEDS_DELISTING",
] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const ORDER_STATUSES = [
  "CREATED",
  "PAID",
  "SHIPPED",
  "DELIVERED",
  "CANCELLED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const OFFER_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "DECLINED",
  "EXPIRED",
  "COUNTERED",
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const EXPENSE_CATEGORIES = [
  "Inventory",
  "Shipping",
  "Packaging",
  "Platform Fees",
  "Equipment",
  "Gas",
  "Advertising",
  "Supplies",
  "Other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const WATCHDOG_STATES = [
  "RUNNING",
  "STOPPED",
  "ERROR",
  "AUTH_REQUIRED",
  "STALE",
] as const;
export type WatchdogState = (typeof WATCHDOG_STATES)[number];

/** N/A sentinel for platform metrics the connector doesn't expose — never
 * invent a number when the platform doesn't provide one. */
export const METRIC_NA = null;
export type Metric = number | typeof METRIC_NA;
