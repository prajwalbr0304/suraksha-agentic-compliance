"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";

interface ChartContainerProps {
  children: React.ReactNode;
  height?: number;
  className?: string;
}

/**
 * Prevents Recharts SSR issues by only rendering charts client-side.
 * Uses ResizeObserver + layout measurement so headless/Playwright reliably
 * sees a positive width (ResizeObserver alone can miss the first layout).
 */
export function ChartContainer({ children, height = 240, className }: ChartContainerProps) {
  const [mounted, setMounted] = useState(false);
  const [hasSize, setHasSize] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!mounted || !ref.current) return;
    const el = ref.current;
    const bump = () => {
      if (el.getBoundingClientRect().width > 0) setHasSize(true);
    };
    bump();
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(bump);
    });
    const ro = new ResizeObserver(bump);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
      ro.disconnect();
    };
  }, [mounted]);

  if (!mounted || !hasSize) {
    return (
      <div ref={!mounted ? undefined : ref} style={{ height, minWidth: 1 }} className={`w-full ${className ?? ""}`}>
        <Skeleton
          style={{ height }}
          className={`w-full rounded-lg bg-[#122131]/60`}
        />
      </div>
    );
  }

  return (
    <div ref={ref} style={{ height, minWidth: 1 }} className={`w-full ${className ?? ""}`}>
      {children}
    </div>
  );
}
