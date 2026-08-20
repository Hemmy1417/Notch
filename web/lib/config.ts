/**
 * Configuration, and the honest defaults behind it.
 *
 * Notch runs against Base Sepolia by default. Mainnet is a deliberate opt-in
 * because the facilitator holds live payment authorizations, and a testnet
 * default that silently becomes mainnet on a copied env file is exactly the
 * kind of accident that costs somebody real money.
 */

export const CHAIN = {
  /** x402 v1 uses named networks, not CAIP-2 ids. */
  network: (process.env.NEXT_PUBLIC_X402_NETWORK ?? "base-sepolia").trim(),
  /**
   * USDC. Base Sepolia and Base mainnet both use 6 decimals.
   * Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
   * Mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
   */
  asset:
    (process.env.NEXT_PUBLIC_X402_ASSET ??
    "0x036CbD53842c5426634e7929541eC2318f3dCF7e").trim(),
  assetDecimals: 6,
} as const;

/**
 * The price floor Notch declares for itself.
 *
 * The median x402 call is about $0.028 and adjudicating a three-cent call is
 * absurd — the dispute costs more than the payment, which is precisely the
 * trap card chargebacks fell into ($315 to settle an $84 dispute). Payments of
 * $1 and above went from 49% to 95% of x402 volume through 2025-26, so that is
 * where Notch engages. Below the floor a quote is served unprotected: it still
 * works, it simply settles immediately with no recourse, exactly as x402 does
 * today.
 */
// BigInt() rather than a 1_000_000n literal: Next rewrites tsconfig on dev and
// resets `target` to ES2017, where BigInt literals do not compile. The call
// form works at every target, so the build cannot be broken by a file we do
// not control.
const USDC_SCALE = BigInt(1_000_000);

/** $1.00 at six decimals. */
export const MIN_PROTECTED_ATOMIC = USDC_SCALE;

export function meetsFloor(atomic: string): boolean {
  try {
    return BigInt(atomic) >= MIN_PROTECTED_ATOMIC;
  } catch {
    return false;
  }
}

export function formatUsdc(atomic: string): string {
  try {
    const v = BigInt(atomic);
    const whole = v / USDC_SCALE;
    const frac = (v % USDC_SCALE).toString().padStart(6, "0").slice(0, 2);
    return `$${whole}.${frac}`;
  } catch {
    return "$0.00";
  }
}

/** The window a buyer gets to challenge, in seconds. */
export const DEFAULT_WINDOW_SECONDS = Number(
  process.env.NEXT_PUBLIC_NOTCH_WINDOW_SECONDS ?? 600,
);

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "";
export const CONTRACT_CONFIGURED = /^0x[a-fA-F0-9]{40}$/.test(CONTRACT_ADDRESS);

export const GENLAYER_RPC =
  process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api";
