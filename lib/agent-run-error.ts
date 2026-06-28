/** Parse FastAPI / proxy JSON error bodies for agent run failures. */
export function agentRunErrorMessage(body: unknown, fallback: string): string {
  if (!body || typeof body !== "object") return fallback;
  const b = body as Record<string, unknown>;
  if (typeof b.error === "string") return b.error;
  if (typeof b.detail === "string") return b.detail;
  const d = b.detail;
  if (
    Array.isArray(d) &&
    d[0] &&
    typeof d[0] === "object" &&
    d[0] !== null &&
    "msg" in d[0] &&
    typeof (d[0] as { msg: unknown }).msg === "string"
  ) {
    return (d[0] as { msg: string }).msg;
  }
  return fallback;
}
