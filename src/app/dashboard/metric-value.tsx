"use client";

import { useEffect, useRef, useState } from "react";

const numberFormat = new Intl.NumberFormat("uk-UA");
const signedFormat = new Intl.NumberFormat("uk-UA", { signDisplay: "exceptZero" });

function AnimatedNumber({ value, signed }: { value: number; signed: boolean }) {
  const current = useRef(value);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (current.current === value) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const from = current.current;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = motion.matches ? 1 : Math.min(1, Math.max(0, (now - start) / 450));
      const eased = 1 - (1 - progress) ** 3;
      current.current = progress === 1 ? value : from + (value - from) * eased;
      setDisplay(Math.round(current.current) || 0);
      if (progress < 1) frame = requestAnimationFrame(tick);
    });

    return () => cancelAnimationFrame(frame);
  }, [value]);

  const format = signed ? signedFormat : numberFormat;
  return <><span aria-hidden="true">{format.format(display)}</span><span className="sr-only">{format.format(value)}</span></>;
}

export function MetricValue({ value, unit, signed = false }: { value: number | null; unit: string; signed?: boolean }) {
  if (value === null) return <><span aria-hidden="true">—</span><span className="sr-only">Немає даних</span></>;
  return (
    <span className="tabular-nums">
      <AnimatedNumber value={value} signed={signed} />{" "}
      <span className="text-[0.65em] font-medium whitespace-nowrap opacity-80">{unit}</span>
    </span>
  );
}
