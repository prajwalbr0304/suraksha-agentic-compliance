"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/glass-card";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { usePrincipal } from "@/hooks/use-principal";
import { withTenantWorkspaceHref } from "@/lib/auth/tenant-routes";
import { mapDbStatusToColumnId } from "@/lib/map-lifecycle";
import { toast } from "sonner";
import { Loader2, Upload, MessageCircleQuestion } from "lucide-react";

type MyTaskRow = {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_date: string;
  obligation_id: string;
  obligations?: { title: string } | { title: string }[] | null;
};

const ASSIGNEE_STATUSES = [
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "In progress" },
  { value: "under_review", label: "Under review" },
];

export default function MyTasksPage() {
  const api = useTenantApi();
  const { principal } = usePrincipal();
  const [rows, setRows] = useState<MyTaskRow[]>([]);
  const [loading, setLoading] = useState(true);

  const evidenceHref = useMemo(() => withTenantWorkspaceHref("/evidence", principal), [principal]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/map-cards/my-tasks");
      if (!res.ok) throw new Error("Could not load tasks");
      const data = (await res.json()) as MyTaskRow[];
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Load failed");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (id: string, status: string) => {
    try {
      const res = await api(`/api/map-cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Update failed");
      }
      toast.success("Status updated");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    }
  };

  const requestClarification = async (row: MyTaskRow) => {
    const note = window.prompt("What do you need clarified?", "");
    if (note == null || !note.trim()) return;
    try {
      const res = await api(`/api/map-cards/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: `[Clarification request] ${note.trim()}` }),
      });
      if (!res.ok) throw new Error("Could not record clarification");
      toast.success("Clarification logged on MAP");
      void load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="My tasks"
        description="MAPs assigned to you — update execution status, upload evidence, or request clarification. Reassignment and archive are manager-only on the MAP board."
      />

      <div className="rounded-xl border border-[#424655]/30 bg-[#051424]/40 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#8c90a1] gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading…
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-[#8c90a1]">No active MAPs assigned to you.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-[#8c90a1]">
                  <th className="px-4 py-3 font-semibold">MAP</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const oblTitle =
                    row.obligations && !Array.isArray(row.obligations)
                      ? row.obligations.title
                      : Array.isArray(row.obligations)
                        ? row.obligations[0]?.title
                        : null;
                  const ui = mapDbStatusToColumnId(String(row.status));
                  return (
                    <tr key={row.id} className="border-b border-white/[0.04] hover:bg-[#0d1c2d]/50">
                      <td className="px-4 py-3 text-[#d4e4fa]">
                        <div className="font-medium">{row.title}</div>
                        {oblTitle ? (
                          <div className="text-[11px] text-[#8c90a1] mt-0.5">Obligation: {oblTitle}</div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[#8c90a1] whitespace-nowrap">
                        {new Date(row.due_date).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          className="rounded-md border border-[#424655]/50 bg-[#0d1c2d] text-[#d4e4fa] text-xs px-2 py-1.5 max-w-[180px]"
                          value={String(row.status)}
                          onChange={(e) => updateStatus(row.id, e.target.value)}
                        >
                          {ASSIGNEE_STATUSES.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                          {row.status && !ASSIGNEE_STATUSES.some((s) => s.value === row.status) ? (
                            <option value={row.status}>{ui} (current)</option>
                          ) : null}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`${evidenceHref}?obligation_id=${encodeURIComponent(row.obligation_id)}`}
                            className="inline-flex items-center gap-1 rounded-md border border-[#b0c6ff]/35 bg-[#b0c6ff]/10 px-2 py-1 text-[11px] font-medium text-[#d4e4fa] hover:bg-[#b0c6ff]/20"
                          >
                            <Upload className="w-3 h-3" /> Evidence
                          </Link>
                          <button
                            type="button"
                            onClick={() => requestClarification(row)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#424655]/50 px-2 py-1 text-[11px] text-[#8c90a1] hover:text-[#d4e4fa]"
                          >
                            <MessageCircleQuestion className="w-3 h-3" /> Clarification
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
