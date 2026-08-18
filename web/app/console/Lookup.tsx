"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Payment-id lookup. Pure navigation — the record page does the reading. */
export function Lookup() {
  const router = useRouter();
  const [id, setId] = useState("");
  const valid = /^pay_[0-9a-f]{16}$/.test(id.trim());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) router.push(`/console/p/${id.trim()}`);
      }}
      className="row"
      style={{ gap: 12, flexWrap: "wrap" }}
    >
      <input
        value={id}
        onChange={(e) => setId(e.target.value)}
        placeholder="pay_…"
        aria-label="Payment id"
        spellCheck={false}
        style={{
          background: "transparent",
          border: 0,
          borderBottom: "1px solid var(--ash)",
          color: "var(--bone)",
          fontFamily: "var(--f-mono)",
          fontSize: 16,
          padding: "10px 2px",
          width: 260,
          outline: "none",
        }}
        onFocus={(e) => (e.currentTarget.style.borderBottomColor = "var(--iris)")}
        onBlur={(e) => (e.currentTarget.style.borderBottomColor = "var(--ash)")}
      />
      <button type="submit" className="pill" disabled={!valid}>
        Open
      </button>
    </form>
  );
}
