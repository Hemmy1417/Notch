"use client";

import { useState } from "react";

/**
 * A long hex value, worn professionally: truncated middle, full value on
 * hover, click to copy. Raw 64-char digests never render full-width.
 */
export function Hash({
  value,
  head = 10,
  tail = 6,
}: {
  value: string;
  head?: number;
  tail?: number;
}) {
  const [copied, setCopied] = useState(false);
  const short =
    value.length > head + tail + 2
      ? `${value.slice(0, head)}…${value.slice(-tail)}`
      : value;

  return (
    <button
      type="button"
      className="hash"
      title={copied ? "Copied" : `${value} — click to copy`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
    >
      {copied ? "copied" : short}
    </button>
  );
}
