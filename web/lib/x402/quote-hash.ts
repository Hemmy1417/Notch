/**
 * The quote hash — computed identically on-chain and off.
 *
 * The contract's `_quote_hash` builds `json.dumps(..., sort_keys=True,
 * separators=(",", ":"))` over five fields and sha256s it. This is the
 * TypeScript twin, and it must match BYTE FOR BYTE: the facilitator serves
 * this hash in the 402, the buyer pays against it, and the contract refuses
 * payments whose quote it never registered. A one-character divergence in
 * canonicalization would make every payment unrecordable.
 *
 * The parity is pinned by a fixed test vector computed independently with
 * Python's json.dumps — not by this file agreeing with itself.
 */
import { createHash } from "node:crypto";

export type QuoteTerms = {
  seller: string;
  criteria: string;
  windowSeconds: number;
  amountAtto: string;
  asset: string;
};

/** Python-json.dumps-compatible string escaping for our field set. */
function pyJsonString(s: string): string {
  // json.dumps escapes exactly: backslash, quote, and control chars; non-ASCII
  // stays literal only with ensure_ascii=False — the contract uses the DEFAULT
  // (ensure_ascii=True), so non-ASCII must become \uXXXX here.
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (code === 0x08) out += "\\b";
    else if (code === 0x09) out += "\\t";
    else if (code === 0x0a) out += "\\n";
    else if (code === 0x0c) out += "\\f";
    else if (code === 0x0d) out += "\\r";
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code > 0x7e) {
      // ensure_ascii: surrogate pairs for astral, single escape for BMP
      if (code > 0xffff) {
        const high = 0xd800 + ((code - 0x10000) >> 10);
        const low = 0xdc00 + ((code - 0x10000) & 0x3ff);
        out += "\\u" + high.toString(16).padStart(4, "0");
        out += "\\u" + low.toString(16).padStart(4, "0");
      } else {
        out += "\\u" + code.toString(16).padStart(4, "0");
      }
    } else out += ch;
  }
  return `"${out}"`;
}

export function canonicalQuote(t: QuoteTerms): string {
  // sort_keys=True over: amountAtto, asset, criteria, seller, windowSeconds
  return (
    "{" +
    `"amountAtto":${pyJsonString(String(t.amountAtto))},` +
    `"asset":${pyJsonString(t.asset.toLowerCase())},` +
    `"criteria":${pyJsonString(t.criteria)},` +
    `"seller":${pyJsonString(t.seller.toLowerCase())},` +
    `"windowSeconds":${Math.trunc(t.windowSeconds)}` +
    "}"
  );
}

export function quoteHash(t: QuoteTerms): string {
  return createHash("sha256").update(canonicalQuote(t), "utf8").digest("hex");
}
