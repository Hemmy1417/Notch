import { GENLAYER_RPC } from "@/lib/config";

/**
 * Same-origin JSON-RPC proxy to StudioNet.
 *
 * The connected wallet talks to the chain directly, but genlayer-js's own
 * reads during a write — nonce, gas, receipt polling — go through the page.
 * A CORS-less rate-limit or error response from StudioNet would otherwise
 * surface in the browser as an opaque "Failed to fetch" mid-transaction, even
 * though the write itself already landed. Routing those reads through our own
 * origin makes the responses readable instead of fatal. (Sentinel's
 * rate-limit-resilience lesson, ported.)
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: string;
  try {
    body = await req.text();
  } catch {
    return Response.json({ error: "unreadable body" }, { status: 400 });
  }

  try {
    const upstream = await fetch(GENLAYER_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch {
    // Never let a CORS-less network failure reach the page as a bare throw —
    // hand back a well-formed JSON-RPC error the client's retry logic knows.
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32029, message: "rpc upstream unreachable" },
        id: null,
      },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}
