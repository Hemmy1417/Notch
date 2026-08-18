import type { Metadata } from "next";
import { Newsreader, Instrument_Sans, Spline_Sans_Mono } from "next/font/google";
import "./globals.css";

/**
 * Three faces, one per register.
 *
 * Newsreader carries the record — criteria, receipts, reasoning. Anything a
 * panel reads verbatim is set in it, because those are the surfaces meant to
 * be read rather than scanned.
 *
 * Instrument Sans runs the interface. Spline Sans Mono carries every machine
 * value: amounts, digests, addresses, epochs.
 */
const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const spline = Spline_Sans_Mono({
  variable: "--font-spline",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Notch — evidence cut before the money moves",
  description:
    "Escrow-backed x402 agent payments. What counts as delivery is agreed " +
    "before payment, the seller signs a receipt to be paid at all, and a " +
    "dispute is judged against evidence nobody could edit afterwards.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${instrument.variable} ${spline.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
