"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/glass-card";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { usePrincipal } from "@/hooks/use-principal";
import { hasPrincipalPermission } from "@/lib/auth/permissions";
import { withTenantWorkspaceHref } from "@/lib/auth/tenant-routes";
import { startAgentPipelineInBackground } from "@/lib/agent-run-async";
import { toast } from "sonner";
import {
  Play,
  Search,
  RefreshCw,
  Plus,
  Pencil,
  Trash2,
  Download,
  Radar,
  CheckCircle2,
  XCircle,
  FileText,
  Terminal,
  Pause,
  Loader2,
  CircleSlash,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type RegChange = {
  id: string;
  title: string;
  regulator: string | null;
  lifecycle_status: string | null;
  url: string | null;
  created_at: string | null;
  published_at: string | null;
  pdf_checksum_sha256: string | null;
  category: string | null;
  tags: string[] | null;
  executive_summary: string | null;
  enabled: boolean | null;
  paused: boolean | null;
  ingestion_error: string | null;
  document_id: string | null;
};

type SearchHit = {
  id: string;
  content: string;
  chunk_index: number | null;
  regulatory_change_id: string | null;
  citation: string | null;
};

type RegulatorySourceView = {
  catalogId: string;
  label: string;
  displayLabel?: string;
  description: string;
  regulator: string;
  feedUrl: string;
  defaultFeedUrl?: string;
  sourceType?: string;
  sourceId: string | null;
  enabled: boolean;
  lastFetchSuccessAt?: string | null;
  lastFetchAttemptAt?: string | null;
  lastFetchError?: string | null;
  health?: "healthy" | "delayed" | "failed" | "unknown";
  allowedHosts?: string[];
  fetchIntervalMinutes?: number;
  lookbackDays?: number;
  autoDownloadPdf?: boolean;
  autoProcess?: boolean;
  approvalRequired?: boolean;
};

type LogLine = {
  id: string;
  ts: string;
  level: string;
  stage: string | null;
  message: string;
  agent: string | null;
  source: string;
};

type MainTab = "sources" | "extracted" | "monitor" | "logs";
type ExtractedTab = "new" | "approved" | "rejected" | "completed" | "failed";

const EXTRACTED_GROUPS: Record<ExtractedTab, string[]> = {
  new: ["new", "awaiting_approval", "failed_ingest"],
  approved: ["approved", "queued", "processing"],
  rejected: ["rejected", "duplicate"],
  completed: ["completed"],
  failed: ["failed_processing"],
};

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const sec = Math.floor((Date.now() - t) / 1000);
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
}

function typePillClasses(type?: string): string {
  const t = (type || "").toLowerCase();
  if (t === "rss" || t === "xml") return "bg-amber-500/15 text-amber-200";
  if (t === "html") return "bg-[#568dff]/15 text-[#b0c6ff]";
  if (t === "pdf") return "bg-purple-500/15 text-purple-200";
  return "bg-[#273647]/40 text-[#8c90a1]";
}

function levelClasses(level: string): string {
  switch (level) {
    case "SUCCESS":
      return "text-emerald-300";
    case "ERROR":
      return "text-red-300";
    case "WARN":
      return "text-amber-300";
    default:
      return "text-[#b0c6ff]";
  }
}

export default function RegulationCenterPage() {
  const api = useTenantApi();
  const { principal } = usePrincipal();
  const canAssign = principal ? hasPrincipalPermission(principal, "obligations.assign") : false;
  const canCreate = principal ? hasPrincipalPermission(principal, "obligations.create") : false;
  const docsHref = useMemo(() => withTenantWorkspaceHref("/documents", principal), [principal]);

  const [mainTab, setMainTab] = useState<MainTab>("sources");
  const [extractedTab, setExtractedTab] = useState<ExtractedTab>("new");

  // Regulations (extracted)
  const [rows, setRows] = useState<RegChange[]>([]);
  const [loading, setLoading] = useState(true);

  // Sources
  const [sources, setSources] = useState<RegulatorySourceView[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceAction, setSourceAction] = useState<string | null>(null);

  // Search
  const [searchQ, setSearchQ] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  // Live logs
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const activeRunId = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit source dialog
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<RegulatorySourceView | null>(null);
  const [editFeedUrl, setEditFeedUrl] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editFetchInterval, setEditFetchInterval] = useState(360);
  const [editLookback, setEditLookback] = useState(7);
  const [editAutoDownloadPdf, setEditAutoDownloadPdf] = useState(true);
  const [editAutoProcess, setEditAutoProcess] = useState(false);
  const [editApprovalRequired, setEditApprovalRequired] = useState(false);

  const loadRegulations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api(`/api/regulation-center?limit=200`);
      const j = (await res.json().catch(() => ({}))) as { changes?: RegChange[]; error?: string };
      if (!res.ok) throw new Error(j.error || res.statusText);
      setRows(j.changes ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load regulations");
    } finally {
      setLoading(false);
    }
  }, [api]);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const res = await api(`/api/regulatory-sources`);
      const j = (await res.json().catch(() => ({}))) as { sources?: RegulatorySourceView[]; error?: string };
      if (!res.ok) throw new Error(j.error || res.statusText);
      setSources(j.sources ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load sources");
    } finally {
      setSourcesLoading(false);
    }
  }, [api]);

  const refreshLogs = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ limit: "150" });
      if (activeRunId.current) qs.set("run_id", activeRunId.current);
      const res = await api(`/api/regulation-center/logs?${qs.toString()}`);
      const j = (await res.json().catch(() => ({}))) as { lines?: LogLine[] };
      if (res.ok) setLogs(j.lines ?? []);
    } catch {
      /* silent */
    }
  }, [api]);

  useEffect(() => {
    void loadRegulations();
    void loadSources();
  }, [loadRegulations, loadSources]);

  // Poll logs while streaming, or whenever the Logs/Monitor tab is open.
  useEffect(() => {
    if (!streaming && mainTab !== "logs" && mainTab !== "monitor") return;
    void refreshLogs();
    const iv = setInterval(() => void refreshLogs(), 3000);
    return () => clearInterval(iv);
  }, [streaming, mainTab, refreshLogs]);

  // ── Regulation actions ──────────────────────────────────────────────
  const patchAction = async (id: string, action: string, extra?: Record<string, unknown>) => {
    const res = await api("/api/regulation-center", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action, ...extra }),
    });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast.error(j.error || "Update failed");
      return;
    }
    toast.success(`Updated (${action})`);
    void loadRegulations();
  };

  const deleteRegulation = async (id: string) => {
    if (!confirm("Delete this regulation permanently?")) return;
    const res = await api(`/api/regulation-center?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) {
      toast.error(j.error || "Delete failed");
      return;
    }
    toast.success("Regulation deleted");
    void loadRegulations();
  };

  const runComplianceAutomation = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setStreaming(true);
    toast.info("Compliance automation started — processing approved queue one at a time.");
    startAgentPipelineInBackground(api, "process_regulations", {
      onStarted: (runId) => {
        activeRunId.current = runId;
        void refreshLogs();
      },
      onFinished: () => {
        setBusy(false);
        setStreaming(false);
        toast.success("Compliance automation finished");
        void loadRegulations();
      },
      onError: (m) => {
        setBusy(false);
        setStreaming(false);
        toast.error(m);
      },
    });
  }, [api, busy, loadRegulations, refreshLogs]);

  // ── Source actions ──────────────────────────────────────────────────
  const addSource = useCallback(
    async (catalogId: string) => {
      setSourceAction(`add:${catalogId}`);
      try {
        const res = await api("/api/regulatory-sources", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ catalogId }),
        });
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(b.error || "Failed to add source");
        toast.success("Source added");
        await loadSources();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Add failed");
      } finally {
        setSourceAction(null);
      }
    },
    [api, loadSources],
  );

  const setSourceEnabled = useCallback(
    async (id: string, enabled: boolean) => {
      setSourceAction(`patch:${id}`);
      try {
        const res = await api("/api/regulatory-sources", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id, enabled }),
        });
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(b.error || "Update failed");
        toast.success(enabled ? "Source enabled" : "Source disabled");
        await loadSources();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Update failed");
      } finally {
        setSourceAction(null);
      }
    },
    [api, loadSources],
  );

  const deleteSource = useCallback(
    async (id: string, name: string) => {
      if (!confirm(`Delete source "${name}"?`)) return;
      setSourceAction(`del:${id}`);
      try {
        const res = await api(`/api/regulatory-sources?id=${encodeURIComponent(id)}`, { method: "DELETE" });
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(b.error || "Delete failed");
        toast.success("Source deleted");
        await loadSources();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setSourceAction(null);
      }
    },
    [api, loadSources],
  );

  const downloadSource = useCallback(
    (row: RegulatorySourceView) => {
      if (!row.sourceId) {
        toast.error("Add this source first, then download.");
        return;
      }
      setStreaming(true);
      toast.info(`Downloading from ${row.displayLabel || row.label}…`);
      startAgentPipelineInBackground(api, "download", {
        extraBody: { source_id: row.sourceId },
        onStarted: (runId) => {
          activeRunId.current = runId;
          void refreshLogs();
        },
        onFinished: () => {
          setStreaming(false);
          toast.success("Download scan complete");
          void loadRegulations();
          void loadSources();
        },
        onError: (m) => {
          setStreaming(false);
          toast.error(m);
        },
      });
    },
    [api, loadRegulations, loadSources, refreshLogs],
  );

  const scanAll = useCallback(() => {
    setStreaming(true);
    activeRunId.current = null;
    toast.info("Monitoring all active sources for new regulations…");
    startAgentPipelineInBackground(api, "download", {
      onStarted: (runId) => {
        activeRunId.current = runId;
        void refreshLogs();
      },
      onFinished: () => {
        setStreaming(false);
        toast.success("Monitor scan complete");
        void loadRegulations();
        void loadSources();
      },
      onError: (m) => {
        setStreaming(false);
        toast.error(m);
      },
    });
  }, [api, loadRegulations, loadSources, refreshLogs]);

  const openEditSource = useCallback((row: RegulatorySourceView) => {
    if (!row.sourceId) return;
    setEditRow(row);
    setEditFeedUrl(row.feedUrl);
    setEditDisplayName(row.displayLabel && row.displayLabel !== row.label ? row.displayLabel : "");
    setEditFetchInterval(typeof row.fetchIntervalMinutes === "number" ? row.fetchIntervalMinutes : 360);
    setEditLookback(typeof row.lookbackDays === "number" ? row.lookbackDays : 7);
    setEditAutoDownloadPdf(row.autoDownloadPdf !== false);
    setEditAutoProcess(!!row.autoProcess);
    setEditApprovalRequired(!!row.approvalRequired);
    setEditOpen(true);
  }, []);

  const saveSourceEdit = useCallback(async () => {
    if (!editRow?.sourceId) return;
    setSourceAction(`edit:${editRow.sourceId}`);
    try {
      const res = await api("/api/regulatory-sources", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editRow.sourceId,
          feed_url: editFeedUrl.trim(),
          source_name: editDisplayName.trim() || null,
          fetch_interval_minutes: editFetchInterval,
          lookback_days: editLookback,
          auto_download_pdf: editAutoDownloadPdf,
          auto_process: editAutoProcess,
          approval_required: editApprovalRequired,
        }),
      });
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(b.error || "Save failed");
      toast.success("Source updated");
      setEditOpen(false);
      setEditRow(null);
      await loadSources();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSourceAction(null);
    }
  }, [
    api,
    loadSources,
    editRow,
    editFeedUrl,
    editDisplayName,
    editFetchInterval,
    editLookback,
    editAutoDownloadPdf,
    editAutoProcess,
    editApprovalRequired,
  ]);

  const runSearch = useCallback(async () => {
    const q = searchQ.trim();
    if (!q) {
      setSearchHits([]);
      return;
    }
    setSearching(true);
    try {
      const res = await api("/api/regulation-center/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q, matchCount: 12 }),
      });
      const j = (await res.json().catch(() => ({}))) as { results?: SearchHit[]; error?: string };
      if (!res.ok) throw new Error(j.error || res.statusText);
      setSearchHits(j.results ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  }, [api, searchQ]);

  // ── Derived ─────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c: Record<ExtractedTab, number> = { new: 0, approved: 0, rejected: 0, completed: 0, failed: 0 };
    for (const r of rows) {
      const ls = r.lifecycle_status ?? "new";
      (Object.keys(EXTRACTED_GROUPS) as ExtractedTab[]).forEach((tab) => {
        if (EXTRACTED_GROUPS[tab].includes(ls)) c[tab] += 1;
      });
    }
    return c;
  }, [rows]);

  const visibleRows = useMemo(
    () => rows.filter((r) => EXTRACTED_GROUPS[extractedTab].includes(r.lifecycle_status ?? "new")),
    [rows, extractedTab],
  );

  const approvedCount = counts.approved;

  const tabBtn = (id: MainTab, label: string, icon: ReactNode) => (
    <button
      type="button"
      onClick={() => setMainTab(id)}
      className={cn(
        "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
        mainTab === id ? "border-[#b0c6ff] text-[#b0c6ff]" : "border-transparent text-[#8c90a1] hover:text-[#d4e4fa]",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Regulation Center"
        description="Manage monitoring sources, download regulations, review extracted PDFs, and run compliance automation."
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void loadRegulations();
                void loadSources();
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-[#424655]/40 px-4 py-2 text-sm text-[#d4e4fa] hover:bg-[#273647]/30"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            <Link
              href={docsHref}
              className="inline-flex items-center rounded-lg border border-[#424655]/40 px-4 py-2 text-sm text-[#8c90a1] hover:text-[#d4e4fa]"
            >
              Documents
            </Link>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1 border-b border-white/[0.06]">
        {tabBtn("sources", "Regulation Sources", <Radar className="w-4 h-4" />)}
        {tabBtn("extracted", "Extracted Regulations", <FileText className="w-4 h-4" />)}
        {tabBtn("monitor", "Monitor", <Radar className="w-4 h-4" />)}
        {tabBtn("logs", "Logs", <Terminal className="w-4 h-4" />)}
      </div>

      {/* ── SOURCES TAB ────────────────────────────────────────────── */}
      {mainTab === "sources" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[#8c90a1]">
              Configured feeds are scanned for new circulars and PDFs. Use approved domains only.
            </p>
            {canCreate ? (
              <button
                type="button"
                onClick={scanAll}
                disabled={streaming}
                className="inline-flex items-center gap-2 rounded-lg bg-[#b0c6ff] px-4 py-2 text-sm font-semibold text-[#002d6f] hover:bg-[#b0c6ff]/90 disabled:opacity-60"
              >
                <Download className="w-4 h-4" />
                Download / Scan all
              </button>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.06]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#0a1a2e]/80 text-[#8c90a1] uppercase text-xs">
                <tr>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Interval</th>
                  <th className="px-3 py-2">Last success</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sourcesLoading ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-[#8c90a1]">
                      Loading sources…
                    </td>
                  </tr>
                ) : sources.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-[#8c90a1]">
                      No sources available.
                    </td>
                  </tr>
                ) : (
                  sources.map((row) => {
                    const configured = Boolean(row.sourceId);
                    const title = row.displayLabel?.trim() || row.label;
                    const acting = sourceAction != null;
                    return (
                      <tr key={row.catalogId} className="border-t border-white/[0.06] hover:bg-[#0a1a2e]/40">
                        <td className="px-3 py-2 max-w-xs">
                          <div className="font-medium text-[#d4e4fa]">{title}</div>
                          <div className="text-[11px] text-[#6b7280] break-all">{row.feedUrl}</div>
                          {row.lastFetchError ? (
                            <div className="text-[11px] text-amber-300/90 mt-0.5 line-clamp-1" title={row.lastFetchError}>
                              {row.lastFetchError}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold uppercase", typePillClasses(row.sourceType))}>
                            {row.sourceType ?? "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-[#8c90a1]">
                          {configured ? `${row.fetchIntervalMinutes ?? 360}m` : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-[#8c90a1]">{fmtRelative(row.lastFetchSuccessAt)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              !configured
                                ? "bg-[#273647]/40 text-[#8c90a1]"
                                : row.enabled
                                  ? "bg-emerald-500/15 text-emerald-200"
                                  : "bg-amber-500/15 text-amber-200",
                            )}
                          >
                            {!configured ? "Not added" : row.enabled ? "Active" : "Disabled"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            {canCreate && !configured ? (
                              <button
                                type="button"
                                disabled={acting}
                                onClick={() => void addSource(row.catalogId)}
                                className="inline-flex items-center gap-1 rounded border border-[#424655]/50 px-2 py-1 text-xs text-[#d4e4fa] hover:bg-[#273647]/40 disabled:opacity-50"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                Add
                              </button>
                            ) : null}
                            {canCreate && configured ? (
                              <>
                                <button
                                  type="button"
                                  disabled={acting || streaming}
                                  onClick={() => downloadSource(row)}
                                  className="inline-flex items-center gap-1 rounded border border-[#b0c6ff]/40 bg-[#b0c6ff]/10 px-2 py-1 text-xs text-[#b0c6ff] hover:bg-[#b0c6ff]/15 disabled:opacity-50"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                  Download
                                </button>
                                <button
                                  type="button"
                                  disabled={acting}
                                  onClick={() => openEditSource(row)}
                                  className="inline-flex items-center gap-1 rounded border border-[#424655]/50 px-2 py-1 text-xs text-[#d4e4fa] hover:bg-[#273647]/40 disabled:opacity-50"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  disabled={acting}
                                  onClick={() => row.sourceId && void setSourceEnabled(row.sourceId, !row.enabled)}
                                  className="inline-flex items-center gap-1 rounded border border-[#424655]/50 px-2 py-1 text-xs text-[#d4e4fa] hover:bg-[#273647]/40 disabled:opacity-50"
                                >
                                  {row.enabled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                                  {row.enabled ? "Disable" : "Enable"}
                                </button>
                                <button
                                  type="button"
                                  disabled={acting}
                                  onClick={() => row.sourceId && void deleteSource(row.sourceId, title)}
                                  className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200 hover:bg-red-500/15 disabled:opacity-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  Delete
                                </button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* ── EXTRACTED TAB ──────────────────────────────────────────── */}
      {mainTab === "extracted" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1">
              {(Object.keys(EXTRACTED_GROUPS) as ExtractedTab[]).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setExtractedTab(tab)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-medium capitalize border transition-colors",
                    extractedTab === tab
                      ? "bg-[#b0c6ff]/15 text-[#b0c6ff] border-[#b0c6ff]/30"
                      : "border-[#424655]/40 text-[#8c90a1] hover:text-[#d4e4fa]",
                  )}
                >
                  {tab} ({counts[tab]})
                </button>
              ))}
            </div>
            {canAssign && extractedTab === "approved" ? (
              <button
                type="button"
                onClick={runComplianceAutomation}
                disabled={busy || approvedCount === 0}
                className="inline-flex items-center gap-2 rounded-lg bg-[#b0c6ff] px-4 py-2 text-sm font-semibold text-[#002d6f] hover:bg-[#b0c6ff]/90 disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Run Compliance Automation
              </button>
            ) : null}
          </div>

          {/* RAG search */}
          <div className="rounded-xl border border-white/[0.06] bg-[#051424]/50 p-3 space-y-3">
            <div className="flex gap-2">
              <input
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void runSearch()}
                placeholder="Search embedded regulation text (RAG)…"
                className="flex-1 rounded-lg bg-[#0a1a2e] border border-[#424655]/40 px-3 py-2 text-sm text-[#d4e4fa]"
              />
              <button
                type="button"
                disabled={searching}
                onClick={() => void runSearch()}
                className="inline-flex items-center gap-2 rounded-lg border border-[#424655]/40 px-4 py-2 text-sm text-[#d4e4fa] hover:bg-[#273647]/30 disabled:opacity-50"
              >
                <Search className="w-4 h-4" />
                {searching ? "…" : "Search"}
              </button>
            </div>
            {searchHits.length > 0 ? (
              <div className="space-y-2 max-h-56 overflow-y-auto text-sm">
                {searchHits.map((h) => (
                  <div key={h.id} className="border border-white/[0.06] rounded-lg p-2 bg-[#0a1a2e]/80">
                    <div className="text-[10px] uppercase text-[#8c90a1]">
                      chunk {h.chunk_index ?? "?"} · {h.citation}
                    </div>
                    <div className="text-[#d4e4fa] line-clamp-4">{h.content}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {loading ? (
            <div className="rounded-xl border border-white/[0.06] px-3 py-10 text-center text-[#8c90a1]">Loading…</div>
          ) : visibleRows.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] px-3 py-10 text-center text-[#8c90a1]">
              No {extractedTab} regulations.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleRows.map((r) => (
                <div key={r.id} className="rounded-xl border border-white/[0.06] bg-[#051424]/50 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[#b0c6ff] shrink-0" />
                        <span className="font-medium text-[#d4e4fa] line-clamp-2">{r.title}</span>
                      </div>
                      <div className="text-xs text-[#8c90a1] mt-1 flex flex-wrap gap-x-3">
                        <span>{r.regulator ?? "—"}</span>
                        {r.created_at ? <span>{new Date(r.created_at).toLocaleDateString()}</span> : null}
                        {r.category ? <span>{r.category}</span> : null}
                      </div>
                    </div>
                    <span className="rounded-full bg-[#273647]/50 px-2 py-0.5 text-[10px] font-medium text-[#b0c6ff] whitespace-nowrap">
                      {r.lifecycle_status ?? "new"}
                    </span>
                  </div>

                  {r.executive_summary ? (
                    <p className="text-xs text-[#8c90a1] line-clamp-3">{r.executive_summary}</p>
                  ) : null}
                  {r.ingestion_error ? (
                    <p className="text-xs text-amber-300/90 line-clamp-2">{r.ingestion_error}</p>
                  ) : null}
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-[#568dff] inline-block">
                      Source link
                    </a>
                  ) : null}

                  {canAssign ? (
                    <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/[0.06]">
                      {extractedTab === "new" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void patchAction(r.id, "approve")}
                            className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-100"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => void patchAction(r.id, "reject", { rejectionReason: "Not applicable" })}
                            className="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                            Reject
                          </button>
                        </>
                      ) : null}
                      {extractedTab === "approved" ? (
                        <button
                          type="button"
                          onClick={() => void patchAction(r.id, "reject", { rejectionReason: "Revoked approval" })}
                          className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-100"
                        >
                          <CircleSlash className="w-3.5 h-3.5" />
                          Revoke
                        </button>
                      ) : null}
                      {extractedTab === "rejected" ? (
                        <button
                          type="button"
                          onClick={() => void patchAction(r.id, "approve")}
                          className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-xs text-emerald-100"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Restore
                        </button>
                      ) : null}
                      {extractedTab === "failed" ? (
                        <button
                          type="button"
                          onClick={() => void patchAction(r.id, "reprocess")}
                          className="inline-flex items-center gap-1 rounded border border-[#568dff]/40 px-2 py-1 text-xs text-[#b0c6ff]"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          Reprocess
                        </button>
                      ) : null}
                      {extractedTab === "completed" ? (
                        <Link
                          href={withTenantWorkspaceHref("/obligations", principal)}
                          className="inline-flex items-center gap-1 rounded border border-[#424655]/50 px-2 py-1 text-xs text-[#d4e4fa]"
                        >
                          View obligations
                        </Link>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void deleteRegulation(r.id)}
                        className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-xs text-red-200 ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-[#8c90a1]">View only</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ── MONITOR TAB ────────────────────────────────────────────── */}
      {mainTab === "monitor" ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-[#8c90a1]">
              The monitoring agent scans every active source for new regulations and PDFs.
            </p>
            {canCreate ? (
              <button
                type="button"
                onClick={scanAll}
                disabled={streaming}
                className="inline-flex items-center gap-2 rounded-lg bg-[#b0c6ff] px-4 py-2 text-sm font-semibold text-[#002d6f] hover:bg-[#b0c6ff]/90 disabled:opacity-60"
              >
                {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Radar className="w-4 h-4" />}
                {streaming ? "Monitoring…" : "Start Monitor"}
              </button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Live console */}
            <div className="rounded-xl border border-white/[0.06] bg-[#03080f] overflow-hidden">
              <div className="px-4 py-2 border-b border-white/[0.06] flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wide">Live console</span>
                <span className={cn("text-xs", streaming ? "text-emerald-300" : "text-[#6b7280]")}>
                  {streaming ? "● streaming" : "idle"}
                </span>
              </div>
              <div className="h-[360px] overflow-y-auto p-3 font-mono text-[11px] space-y-1">
                {logs.length === 0 ? (
                  <p className="text-[#6b7280]">No log activity yet. Start the monitor to see live output.</p>
                ) : (
                  logs.map((l) => (
                    <div key={l.id} className="flex gap-2">
                      <span className="text-[#5c6a8a] shrink-0">{new Date(l.ts).toLocaleTimeString()}</span>
                      <span className={cn("shrink-0 w-14", levelClasses(l.level))}>{l.level}</span>
                      <span className="text-[#9aa5c4]">{l.message}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Source status */}
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <div className="px-4 py-2 border-b border-white/[0.06]">
                <span className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wide">Source status</span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[#0a1a2e]/80 text-[#8c90a1] uppercase text-xs">
                    <tr>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Last success</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.filter((s) => s.sourceId).length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-6 text-center text-[#8c90a1]">
                          No configured sources.
                        </td>
                      </tr>
                    ) : (
                      sources
                        .filter((s) => s.sourceId)
                        .map((s) => (
                          <tr key={s.catalogId} className="border-t border-white/[0.06]">
                            <td className="px-3 py-2 text-[#d4e4fa]">{s.displayLabel || s.label}</td>
                            <td className="px-3 py-2 text-xs text-[#8c90a1]">{fmtRelative(s.lastFetchSuccessAt)}</td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[11px]",
                                  s.lastFetchError
                                    ? "bg-red-500/15 text-red-200"
                                    : s.enabled
                                      ? "bg-emerald-500/15 text-emerald-200"
                                      : "bg-amber-500/15 text-amber-200",
                                )}
                              >
                                {s.lastFetchError ? "Error" : s.enabled ? "OK" : "Disabled"}
                              </span>
                            </td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── LOGS TAB ───────────────────────────────────────────────── */}
      {mainTab === "logs" ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-[#8c90a1]">Unified agent &amp; processing logs (auto-refresh every 3s).</p>
            <button
              type="button"
              onClick={() => void refreshLogs()}
              className="inline-flex items-center gap-2 rounded-lg border border-[#424655]/40 px-3 py-1.5 text-sm text-[#d4e4fa] hover:bg-[#273647]/30"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
          <div className="rounded-xl border border-white/[0.06] overflow-hidden">
            <div className="max-h-[560px] overflow-y-auto divide-y divide-white/[0.04]">
              {logs.length === 0 ? (
                <p className="px-3 py-10 text-center text-[#8c90a1]">No logs yet.</p>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className="flex gap-3 px-3 py-2 font-mono text-[11px] hover:bg-[#0a1a2e]/40">
                    <span className="text-[#5c6a8a] w-40 shrink-0">{new Date(l.ts).toLocaleString()}</span>
                    <span className={cn("w-16 shrink-0 font-semibold", levelClasses(l.level))}>{l.level}</span>
                    <span className="text-[#9aa5c4] flex-1">{l.message}</span>
                    <span className="text-[#5c6a8a] shrink-0">[{l.agent || l.stage || l.source}]</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Edit source dialog ─────────────────────────────────────── */}
      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditRow(null); }}>
        <DialogContent className="max-w-lg border-[#424655]/40 bg-[#0a1929] text-[#d4e4fa]">
          <DialogHeader>
            <DialogTitle>Edit regulatory source</DialogTitle>
            <DialogDescription className="text-[#8c90a1]">
              URL must stay on approved domains for this feed. Empty display name resets to the catalog label.
            </DialogDescription>
          </DialogHeader>
          {editRow && (
            <div className="space-y-3 py-2">
              <div>
                <label className="text-xs font-medium text-[#8c90a1]">HTTPS feed URL</label>
                <input
                  className="mt-1 w-full rounded-md border border-[#424655]/50 bg-[#273647]/30 px-3 py-2 text-sm text-[#d4e4fa]"
                  value={editFeedUrl}
                  onChange={(e) => setEditFeedUrl(e.target.value)}
                  spellCheck={false}
                />
                {editRow.allowedHosts?.length ? (
                  <p className="mt-1 text-[11px] text-[#6b7280]">Allowed hosts: {editRow.allowedHosts.join(", ")}</p>
                ) : null}
              </div>
              <div>
                <label className="text-xs font-medium text-[#8c90a1]">Display name (optional)</label>
                <input
                  className="mt-1 w-full rounded-md border border-[#424655]/50 bg-[#273647]/30 px-3 py-2 text-sm text-[#d4e4fa]"
                  value={editDisplayName}
                  onChange={(e) => setEditDisplayName(e.target.value)}
                  placeholder={editRow.label}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-[#8c90a1]">Fetch interval (min)</label>
                  <input
                    type="number"
                    min={1}
                    max={10080}
                    className="mt-1 w-full rounded-md border border-[#424655]/50 bg-[#273647]/30 px-3 py-2 text-sm text-[#d4e4fa]"
                    value={editFetchInterval}
                    onChange={(e) => setEditFetchInterval(Number(e.target.value) || 360)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-[#8c90a1]">Lookback (days)</label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    className="mt-1 w-full rounded-md border border-[#424655]/50 bg-[#273647]/30 px-3 py-2 text-sm text-[#d4e4fa]"
                    value={editLookback}
                    onChange={(e) => setEditLookback(Number(e.target.value) || 7)}
                  />
                </div>
              </div>
              <div className="space-y-2 text-sm text-[#d4e4fa]">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editAutoDownloadPdf} onChange={(e) => setEditAutoDownloadPdf(e.target.checked)} />
                  Auto-download PDF on detect
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editAutoProcess} onChange={(e) => setEditAutoProcess(e.target.checked)} />
                  Auto-process queue after ingest (same run)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={editApprovalRequired} onChange={(e) => setEditApprovalRequired(e.target.checked)} />
                  Require approval before queueing extraction
                </label>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveSourceEdit()} disabled={!!sourceAction}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
