/** Capabilities a connector may or may not support. The UI must check these
 * rather than assuming every platform can do everything. */
export const CONNECTOR_CAPABILITIES = [
  "messages",
  "sendMessages",
  "listings",
  "offers",
  "orders",
  "sales",
  "shipping",
] as const;

export type ConnectorCapability = (typeof CONNECTOR_CAPABILITIES)[number];

export interface HealthStatus {
  online: boolean;
  authenticated: boolean;
  lastCheckedAt: string;
  message?: string;
}
