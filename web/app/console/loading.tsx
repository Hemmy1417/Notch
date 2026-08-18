import { ConsoleShell } from "../components/ConsoleShell";

/** Shown while a console page reads the chain. Quiet, no spinners. */
export default function Loading() {
  return (
    <ConsoleShell>
      <div className="wrap section" style={{ paddingTop: 60 }}>
        <p className="t-label t-label-spark">Reading the chain…</p>
        <p className="t-caption" style={{ marginTop: 14 }}>
          Every number here is a live contract read. StudioNet answers in a
          moment.
        </p>
      </div>
    </ConsoleShell>
  );
}
