/**
 * Chain config for the browser wallet write path. All values are public.
 *
 * The page's genlayer-js client reads through the same-origin /api/rpc proxy
 * (CORS-safe); the wallet extension talks to StudioNet directly, so the
 * network-add path below uses the direct RPC.
 */
import { studionet } from "genlayer-js/chains";
import { GENLAYER_RPC, CONTRACT_ADDRESS } from "@/lib/config";

export const CHAIN_RPC_DIRECT = GENLAYER_RPC;

function pageRpcUrl(): string {
  if (typeof window !== "undefined") return `${window.location.origin}/api/rpc`;
  return CHAIN_RPC_DIRECT;
}

/** studionet, but with the read transport pointed at the proxy. */
export const CHAIN = {
  ...studionet,
  rpcUrls: {
    ...studionet.rpcUrls,
    default: { http: [pageRpcUrl()] },
    public: { http: [pageRpcUrl()] },
  },
} as typeof studionet;

export const CHAIN_HEX = ("0x" + studionet.id.toString(16)) as `0x${string}`;
export const CHAIN_NAME = studionet.name;
export const CHAIN_RPC = CHAIN_RPC_DIRECT;
export const COURT_ADDRESS = CONTRACT_ADDRESS as `0x${string}`;

// BigInt() call form, not a literal: Next resets tsconfig target to ES2017 on
// dev, where 10n**18n does not compile (see lib/config.ts for the same guard).
export const GEN = BigInt("1000000000000000000");
