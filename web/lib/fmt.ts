/** Display formatting for the console — relative times, floored GEN. */

/** "3m ago" / "2h ago" / "4d ago". Coarse on purpose: pages revalidate. */
export function ago(epochSeconds: number): string {
  if (!epochSeconds) return "—";
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epochSeconds);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function isoUtc(epochSeconds: number): string {
  if (!epochSeconds) return "—";
  return new Date(epochSeconds * 1000).toISOString().replace(".000Z", " UTC").replace("T", " ");
}

/**
 * Floor, never round: a slashed bond must read as dented, and a display
 * that rounds 0.99999999999875 back up to 1.0000 is a small lie.
 */
export function fmtGen(atto: string): string {
  const v = Number(BigInt(atto)) / 1e18;
  return (Math.floor(v * 10000) / 10000).toFixed(4);
}
