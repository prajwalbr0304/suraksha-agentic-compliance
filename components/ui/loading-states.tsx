"use client";

import { Skeleton } from "@/components/ui/skeleton";

export function TableRowSkeleton({ cols = 8 }: { cols?: number }) {
  return (
    <div className="grid gap-4 px-5 py-3.5 items-center" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-4 w-full bg-[#273647]/50" />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="bg-[#0d1c2d]/80 rounded-lg p-4 border border-[#424655]/20 space-y-3">
      <Skeleton className="h-4 w-3/4 bg-[#273647]/50" />
      <Skeleton className="h-3 w-1/4 bg-[#273647]/50" />
      <div className="flex gap-1">
        <Skeleton className="h-1.5 flex-1 bg-[#273647]/50" />
        <Skeleton className="h-1.5 flex-1 bg-[#273647]/50" />
        <Skeleton className="h-1.5 flex-1 bg-[#273647]/50" />
      </div>
      <div className="flex justify-between pt-2 border-t border-white/[0.04]">
        <Skeleton className="h-3 w-20 bg-[#273647]/50" />
        <Skeleton className="h-3 w-8 bg-[#273647]/50" />
      </div>
    </div>
  );
}

export function KPISkeleton() {
  return (
    <div className="glass-panel rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-24 bg-[#273647]/50" />
        <Skeleton className="h-8 w-8 rounded-lg bg-[#273647]/50" />
      </div>
      <Skeleton className="h-8 w-20 bg-[#273647]/50" />
      <Skeleton className="h-3 w-32 bg-[#273647]/50" />
    </div>
  );
}

export function TimelineSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-0 divide-y divide-white/[0.03]">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 px-5 py-4">
          <Skeleton className="w-9 h-9 rounded-full shrink-0 bg-[#273647]/50" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4 bg-[#273647]/50" />
            <Skeleton className="h-3 w-1/4 bg-[#273647]/50" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.27 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <p className="text-sm text-[#d4e4fa] font-medium mb-1">Something went wrong</p>
      <p className="text-xs text-[#8c90a1] max-w-sm mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] text-sm hover:border-[#b0c6ff]/30 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
