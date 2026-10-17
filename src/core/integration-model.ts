export const integrationStatuses = [
  "integrated",
  "not_integrated",
  "unavailable",
  "not_required",
] as const;

export type IntegrationStatus = (typeof integrationStatuses)[number];
