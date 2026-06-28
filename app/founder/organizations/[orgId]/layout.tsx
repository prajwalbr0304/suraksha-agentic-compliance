"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { TenantApiProvider } from "@/contexts/tenant-api-context";
import { authFetch } from "@/lib/auth/client";
import { useEffect, useState } from "react";

const TABS: { label: string; segment: string }[] = [
  { label: "Overview", segment: "" },
  { label: "Upload", segment: "upload" },
  { label: "Documents", segment: "documents" },
  { label: "Obligations", segment: "obligations" },
  { label: "Compliance Action Board", segment: "map-board" },
  { label: "My tasks", segment: "my-tasks" },
  { label: "Evidence", segment: "evidence" },
  { label: "Readiness", segment: "readiness" },
  { label: "Regulatory Change Analysis", segment: "drift" },
  { label: "Compliance Impact Analysis", segment: "impact" },
  { label: "Security Findings", segment: "security-findings" },
  { label: "Knowledge Graph", segment: "knowledge-graph" },
  { label: "Departments", segment: "departments" },
  { label: "Teams", segment: "teams" },
  { label: "Users", segment: "users" },
  { label: "Access Control", segment: "access" },
  { label: "Audit Trail", segment: "audit" },
];

export default function FounderOrgLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const pathname = usePathname();
  const orgId = params.orgId as string;
  const base = `/founder/organizations/${orgId}`;
  const [bankName, setBankName] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/founder/banks");
        if (!res.ok || cancelled) return;
        const banks = (await res.json()) as { id: string; name: string }[];
        const b = banks.find((x) => x.id === orgId);
        if (!cancelled && b) setBankName(b.name);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return (
    <TenantApiProvider orgId={orgId}>
      <div className="space-y-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-sm text-[#8c90a1]">
            <Link href="/founder/organizations" className="hover:text-[#b0c6ff] transition-colors">
              Organizations
            </Link>
            <span>/</span>
            <span className="text-[#d4e4fa] font-medium">{bankName || orgId.slice(0, 8) + "…"}</span>
          </div>
          <p className="text-xs text-[#5a637a] max-w-3xl">
            Tenant workspace — operational modules for this bank. Platform navigation stays in the sidebar.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-white/[0.06] pb-3">
          {TABS.map((tab) => {
            const href = tab.segment ? `${base}/${tab.segment}` : base;
            const isOverview = !tab.segment;
            const isActive = isOverview
              ? pathname === base || pathname === `${base}/`
              : pathname === href || pathname?.startsWith(`${href}/`);
            return (
              <Link
                key={tab.segment || "overview"}
                href={href}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border",
                  isActive
                    ? "bg-[#b0c6ff]/15 text-[#b0c6ff] border-[#b0c6ff]/30"
                    : "text-[#8c90a1] border-transparent hover:bg-[#273647]/40 hover:text-[#d4e4fa]"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>

        {children}
      </div>
    </TenantApiProvider>
  );
}
