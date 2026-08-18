import Link from "next/link";
import { Mark } from "./Mark";

/**
 * Transparent on the void — no bar, no border, no blur. The pill on the
 * right is the view's one filled action.
 */
export function Nav({ active }: { active?: "console" }) {
  return (
    <nav className="wrap row-b" style={{ paddingTop: 30, paddingBottom: 30 }}>
      <Link href="/" className="row" style={{ gap: 10, textDecoration: "none" }}>
        <Mark />
        <span
          style={{
            fontWeight: 600,
            fontSize: 14,
            letterSpacing: "0.16em",
            color: "var(--bone)",
          }}
        >
          NOTCH
        </span>
      </Link>
      <div className="row" style={{ gap: 30 }}>
        <a href="/#protocol" className="ghost t-label" style={{ letterSpacing: "0.1em" }}>
          Protocol
        </a>
        <a href="/#proof" className="ghost t-label" style={{ letterSpacing: "0.1em" }}>
          Proof
        </a>
        {active === "console" ? (
          <span className="t-label" style={{ color: "var(--bone)", letterSpacing: "0.1em" }}>
            Console
          </span>
        ) : (
          <Link href="/console" className="pill">
            Console
          </Link>
        )}
      </div>
    </nav>
  );
}
