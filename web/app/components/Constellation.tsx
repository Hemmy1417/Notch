"use client";

import { useEffect, useRef } from "react";

/**
 * The split tally, as a constellation.
 *
 * A tally stick was notched at the moment of the deal and split lengthwise;
 * each party held half, and neither could forge it because the cuts had to
 * match across the grain. Here the two halves float in the void a hand's
 * width apart, drawn as ~1100 tiny outlined triangles — and the notches
 * MATCH: each cut in the left half mirrors a cut in the right, the way the
 * quote hash on the 402 mirrors the quote hash on the court.
 *
 * Pure canvas, no libraries. Honors prefers-reduced-motion by rendering a
 * single static frame.
 */

const COLORS = [
  ["#8052ff", 0.34], // iris
  ["#9a73ff", 0.14],
  ["#ffb829", 0.16], // spark
  ["#15846e", 0.10], // verdant
  ["#2fae91", 0.06],
  ["#5a7dff", 0.10],
  ["#ff7ac6", 0.05],
  ["#b38cff", 0.05],
] as const;

function pickColor(r: number): string {
  let acc = 0;
  for (const [c, w] of COLORS) {
    acc += w;
    if (r <= acc) return c;
  }
  return COLORS[0][0];
}

type Particle = {
  x: number; y: number;      // home position
  s: number;                 // size
  rot: number;               // base rotation
  color: string;
  a: number;                 // base alpha
  ph: number;                // phase for drift/twinkle
  sp: number;                // speed multiplier
  amp: number;               // drift amplitude
};

/** The two tally halves with matching notch cuts, in unit space (0..1). */
function insideTally(u: number, v: number): boolean {
  // Tilt the frame a few degrees so the stick doesn't sit on a grid.
  const cx = u - 0.5, cy = v - 0.5;
  const t = -0.14; // radians
  const x = cx * Math.cos(t) - cy * Math.sin(t) + 0.5;
  const y = cx * Math.sin(t) + cy * Math.cos(t) + 0.5;

  const top = 0.06, bottom = 0.94;
  const gapL = 0.46, gapR = 0.54;      // the split
  const leftL = 0.30, rightR = 0.70;   // outer edges

  if (y < top || y > bottom) return false;

  const inLeft = x >= leftL && x <= gapL;
  const inRight = x >= gapR && x <= rightR;
  if (!inLeft && !inRight) return false;

  // Matching notch cuts on the FACING edges — the deal marks.
  // Each notch is a triangle cut into the half, apex pointing outward.
  const notches = [0.24, 0.5, 0.74];
  const depth = 0.085, half = 0.055;
  for (const ny of notches) {
    const dy = Math.abs(y - ny);
    if (dy < half) {
      const cut = depth * (1 - dy / half); // triangular profile
      if (inLeft && x > gapL - cut) return false;
      if (inRight && x < gapR + cut) return false;
    }
  }
  return true;
}

export function Constellation() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let particles: Particle[] = [];
    let W = 0, H = 0, dpr = 1;

    // Deterministic-enough PRNG so hot reloads don't reshuffle wildly.
    let seed = 41;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    function build() {
      const rect = canvas!.parentElement!.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(280, rect.width);
      H = Math.max(320, rect.height);
      canvas!.width = W * dpr;
      canvas!.height = H * dpr;
      canvas!.style.width = `${W}px`;
      canvas!.style.height = `${H}px`;

      particles = [];
      const target = Math.min(1150, Math.floor((W * H) / 340));

      // The tally: rejection-sample the silhouette.
      let placed = 0, guard = 0;
      while (placed < target && guard < target * 60) {
        guard++;
        const u = rnd(), v = rnd();
        if (!insideTally(u, v)) continue;
        placed++;
        particles.push({
          x: u * W, y: v * H,
          s: 1.8 + rnd() * 2.6,
          rot: rnd() * Math.PI * 2,
          color: pickColor(rnd()),
          a: 0.4 + rnd() * 0.55,
          ph: rnd() * Math.PI * 2,
          sp: 0.4 + rnd() * 0.8,
          amp: 1 + rnd() * 2.4,
        });
      }

      // Ambient scatter, sparse and dim, drifting around the halves.
      const ambient = Math.floor(target * 0.13);
      for (let i = 0; i < ambient; i++) {
        particles.push({
          x: rnd() * W, y: rnd() * H,
          s: 1.4 + rnd() * 2,
          rot: rnd() * Math.PI * 2,
          color: pickColor(rnd()),
          a: 0.08 + rnd() * 0.2,
          ph: rnd() * Math.PI * 2,
          sp: 0.25 + rnd() * 0.5,
          amp: 2 + rnd() * 5,
        });
      }
    }

    function draw(t: number) {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, W, H);
      ctx!.lineWidth = 1.1;
      for (const p of particles) {
        const w = t * 0.00045 * p.sp + p.ph;
        const dx = Math.sin(w) * p.amp;
        const dy = Math.cos(w * 0.83) * p.amp;
        const tw = 0.75 + 0.25 * Math.sin(w * 1.7);
        ctx!.globalAlpha = p.a * tw;
        ctx!.strokeStyle = p.color;
        const x = p.x + dx, y = p.y + dy, s = p.s;
        const r = p.rot + Math.sin(w * 0.5) * 0.25;
        ctx!.beginPath();
        for (let k = 0; k < 3; k++) {
          const ang = r + (k * Math.PI * 2) / 3;
          const px = x + Math.cos(ang) * s;
          const py = y + Math.sin(ang) * s;
          if (k === 0) ctx!.moveTo(px, py);
          else ctx!.lineTo(px, py);
        }
        ctx!.closePath();
        ctx!.stroke();
      }
      ctx!.globalAlpha = 1;
    }

    function loop(t: number) {
      draw(t);
      raf = requestAnimationFrame(loop);
    }

    build();
    // Always paint one frame synchronously: rAF is throttled in hidden tabs,
    // and the constellation should exist from the first composited frame.
    draw(0);
    if (!reduced) {
      raf = requestAnimationFrame(loop);
    }

    const ro = new ResizeObserver(() => {
      build();
      if (reduced) draw(0);
    });
    ro.observe(canvas.parentElement!);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      aria-hidden
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 380 }}
    >
      <canvas ref={ref} style={{ display: "block" }} />
    </div>
  );
}
