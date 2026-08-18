import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

/**
 * One typeface, three weights, and the weights are the point:
 *
 *   200 carries every paragraph — body copy is ultra-light so the reading
 *       surface feels airy rather than argued.
 *   400 carries every headline, at massive scale with hard negative
 *       tracking. Hierarchy comes from size, never from bolding.
 *   600 exists only for small uppercase labels and the one pill button.
 *
 * Machine values (ids, digests, epochs) fall back to the system monospace —
 * a hash is not prose and should not pretend to be.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["200", "400", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Notch — evidence fixed before the money moves",
  description:
    "Escrow-backed x402 agent payments. What counts as delivery is agreed " +
    "before payment, the seller signs a receipt to be paid at all, and a " +
    "dispute is judged against evidence nobody could edit afterwards.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
