export const FINISHED_STATUSES = new Set([
  "success",
  "failed",
  "canceled",
  "skipped",
  "manual",
]);
export function isFinishedStatus(status: string): boolean {
  return FINISHED_STATUSES.has(status.toLowerCase());
}
