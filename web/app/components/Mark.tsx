/**
 * The mark: a tally half with the notch cut out of its facing edge.
 * Sharp-edged and angular like the particles, iris falling to verdant —
 * the only gradient in the product, reserved for the logo by rule.
 */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      style={{ flexShrink: 0, display: "block" }}
    >
      <defs>
        <linearGradient id="notch-mark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8052ff" />
          <stop offset="1" stopColor="#15846e" />
        </linearGradient>
      </defs>
      <path
        d="M11 2 L23 4 L23 12 L15.5 16 L23 20 L23 28 L11 30 Z"
        fill="url(#notch-mark)"
        transform="rotate(6 16 16)"
      />
    </svg>
  );
}
