"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type {
  KPIMetric,
  ActivityItem,
  RiskScore,
  ComplianceTrend,
  HeroMetric,
  AiActivityItem,
  AgentQueueMetrics,
  LiveCoordinatorRunState,
  ActivityLogMode,
} from "@/types";
import { scoreToOperationalRiskBand } from "@/lib/risk-bands";

interface DashboardKPIs {
  total_obligations: number;
  compliance_score: number;
  pending_maps: number;
  docs_processed: number;
  overdue_count: number;
  high_risk_count: number;
  new_regulations_30d?: number;
  open_obligations?: number;
  critical_maps?: number;
}

export type { ActivityLogMode } from "@/types";

export interface DashboardData {
  kpis: KPIMetric[];
  heroMetrics: HeroMetric[];
  aiActivityFeed: AiActivityItem[];
  queueMetrics: AgentQueueMetrics | null;
  /** Latest coordinator run (running row preferred) for pipeline stage / errors */
  liveCoordinatorRun: LiveCoordinatorRunState | null;
  recentActivity: ActivityItem[];
  riskScores: RiskScore[];
  complianceTrends: ComplianceTrend[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

const THIRTY_DAYS_AGO = new Date(Date.now() - 30 * 86400000).toISOString();

const ACTIVITY_LIMITS = {
  compact: { agent: 52, audit: 20, maxLines: 32 },
  full: { agent: 240, audit: 100, maxLines: 200 },
} as const;

type CoordRunRow = {
  id: string;
  stats: unknown;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
};

function deriveLiveCoordinatorRun(rows: CoordRunRow[] | null | undefined): LiveCoordinatorRunState | null {
  if (!rows?.length) return null;
  const run = rows.find((r) => r.status === "running") ?? rows[0];
  const s = run.stats && typeof run.stats === "object" ? (run.stats as Record<string, unknown>) : {};
  const st = run.status;
  if (st !== "running" && st !== "completed" && st !== "failed") return null;
  return {
    runId: run.id,
    status: st,
    pipeline: typeof s.pipeline === "string" ? s.pipeline : null,
    stageIndex: typeof s.pipeline_stage_index === "number" ? s.pipeline_stage_index : null,
    stageKey: typeof s.pipeline_stage_key === "string" ? s.pipeline_stage_key : null,
    stageLabel: typeof s.pipeline_stage_label === "string" ? s.pipeline_stage_label : null,
    errorMessage: typeof s.pipeline_error_message === "string" ? s.pipeline_error_message : null,
    summary: run.summary,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
  };
}

function mergeActivityFeed(
  agentRows: Record<string, unknown>[],
  auditRows: Record<string, unknown>[],
  mode: ActivityLogMode,
): AiActivityItem[] {
  const verbose = mode === "full";
  const maxLines = ACTIVITY_LIMITS[mode].maxLines;

  const fromAgent = agentRows
    .map((row) => {
      const iso = row.created_at as string;
      const ev = narrativeFromAgentEvent(
        {
          id: `ev:${row.id as string}`,
          type: String(row.type),
          message: (row.message as string) ?? "",
          created_at: iso,
          payload: (row.payload as Record<string, unknown>) || undefined,
        },
        verbose,
      );
      if (!ev) return null;
      return { ...ev, sortKey: iso, timeLabel: formatClock(iso) };
    })
    .filter(Boolean) as AiActivityItem[];

  const fromAudit = auditRows
    .map((row) => {
      const iso = row.created_at as string;
      const ev = narrativeFromAuditRow({
        id: `au:${row.id as string}`,
        action: String(row.action),
        details: String(row.details ?? ""),
        actor: String(row.actor ?? ""),
        created_at: iso,
      });
      if (!ev) return null;
      return { ...ev, sortKey: iso, timeLabel: formatClock(iso) };
    })
    .filter(Boolean) as AiActivityItem[];

  const merged = [...fromAgent, ...fromAudit];
  merged.sort((a, b) => {
    const ta = a.sortKey ? new Date(a.sortKey).getTime() : 0;
    const tb = b.sortKey ? new Date(b.sortKey).getTime() : 0;
    return tb - ta;
  });
  const seen = new Set<string>();
  const deduped: AiActivityItem[] = [];
  for (const item of merged) {
    const key = mode === "full" ? item.id : item.line.slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    const iso = item.sortKey;
    deduped.push({
      ...item,
      timestamp: iso ? formatRelativeTime(iso) : item.timestamp,
      timeLabel: iso ? formatClock(iso) : item.timeLabel,
    });
    if (deduped.length >= maxLines) break;
  }
  return deduped;
}

function computeDeferredFromCoordRows(cruns: CoordRunRow[] | null | undefined): number {
  if (!cruns?.length) return 0;
  const full = cruns.find((r) => {
    const s = r.stats as Record<string, unknown> | null | undefined;
    return Boolean(s && s.pipeline === "full");
  });
  const st = full?.stats as Record<string, unknown> | undefined;
  if (st != null && st.queue_deferred_regulatory_changes != null) {
    const n = Number(st.queue_deferred_regulatory_changes);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function useDashboard(opts?: { activityLogMode?: ActivityLogMode }): DashboardData {
  const activityLogMode = opts?.activityLogMode ?? "compact";
  const [kpis, setKpis] = useState<KPIMetric[]>([]);
  const [heroMetrics, setHeroMetrics] = useState<HeroMetric[]>([]);
  const [aiActivityFeed, setAiActivityFeed] = useState<AiActivityItem[]>([]);
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);
  const [riskScores, setRiskScores] = useState<RiskScore[]>([]);
  const [complianceTrends, setComplianceTrends] = useState<ComplianceTrend[]>([]);
  const [queueMetrics, setQueueMetrics] = useState<AgentQueueMetrics | null>(null);
  const [liveCoordinatorRun, setLiveCoordinatorRun] = useState<LiveCoordinatorRunState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  /** Avoid blanking the live activity panel on every Realtime refetch (was mistaken for "only updates on refresh"). */
  const initialDashboardFetchDoneRef = useRef(false);

  const applyHeroFromKpis = useCallback((k: DashboardKPIs): HeroMetric[] => {
    const newRegs = k.new_regulations_30d ?? 0;
    const openObl = k.open_obligations ?? 0;
    const critMaps = k.critical_maps ?? 0;
    const readiness = Number(k.compliance_score) || 0;
    const readinessAccent: HeroMetric["accent"] =
      readiness >= 85 ? "success" : readiness >= 70 ? "warning" : "danger";
    return [
      {
        title: "New regulations detected",
        value: String(newRegs),
        subtitle: "Last 30 days",
        accent: newRegs > 0 ? "info" : "neutral",
      },
      {
        title: "Open obligations",
        value: String(openObl),
        subtitle: `${k.overdue_count} overdue`,
        accent: k.overdue_count > 0 ? "danger" : "neutral",
      },
      {
        title: "Critical MAPs",
        value: String(critMaps),
        subtitle: "Open critical actions",
        accent: critMaps > 0 ? "danger" : "success",
      },
      {
        title: "Compliance readiness",
        value: `${readiness.toFixed(0)}%`,
        subtitle: "Org obligation compliance",
        accent: readinessAccent,
      },
    ];
  }, []);

  const fetchAll = useCallback(async () => {
    const showFullPageLoader = !initialDashboardFetchDoneRef.current;
    if (showFullPageLoader) {
      setIsLoading(true);
    }
    setError(null);

    try {
      let kpiResult: DashboardKPIs;
      const { data: kpiData, error: kpiError } = await supabase.rpc("get_dashboard_kpis");

      if (kpiError) {
        const [oblRes, docsRes, mapsRes, regRes] = await Promise.all([
          supabase.from("obligations").select("id, status, priority"),
          supabase.from("documents").select("id, status"),
          supabase.from("map_cards").select("id, status, priority"),
          supabase.from("regulatory_changes").select("id, created_at").gte("created_at", THIRTY_DAYS_AGO),
        ]);
        const obls = (oblRes.data ?? []) as { id: string; status: string; priority: string }[];
        const docs = (docsRes.data ?? []) as { id: string; status: string }[];
        const maps = (mapsRes.data ?? []) as { id: string; status: string; priority: string }[];
        const regs = (regRes.data ?? []) as { id: string }[];
        const total = obls.length;
        const compliant = obls.filter((o) => o.status === "compliant").length;
        const overdue = obls.filter((o) => o.status === "overdue").length;
        const highRisk = obls.filter((o) => o.priority === "critical" || o.priority === "high").length;
        const pendingMaps = maps.filter((m) => m.status !== "completed" && m.status !== "rejected").length;
        const docsProcessed = docs.filter((d) => d.status === "processed").length;
        const openObl = obls.filter((o) => o.status !== "compliant").length;
        const criticalMaps = maps.filter((m) => m.priority === "critical" && m.status !== "completed" && m.status !== "rejected").length;
        kpiResult = {
          total_obligations: total,
          compliance_score: total > 0 ? Math.round((compliant / total) * 100 * 10) / 10 : 0,
          overdue_count: overdue,
          high_risk_count: highRisk,
          pending_maps: pendingMaps,
          docs_processed: docsProcessed,
          new_regulations_30d: regs.length,
          open_obligations: openObl,
          critical_maps: criticalMaps,
        };
      } else {
        const parsed = (typeof kpiData === "string" ? JSON.parse(kpiData) : kpiData) as Partial<DashboardKPIs>;
        kpiResult = {
          total_obligations: parsed.total_obligations ?? 0,
          compliance_score: parsed.compliance_score ?? 0,
          pending_maps: parsed.pending_maps ?? 0,
          docs_processed: parsed.docs_processed ?? 0,
          overdue_count: parsed.overdue_count ?? 0,
          high_risk_count: parsed.high_risk_count ?? 0,
          new_regulations_30d: parsed.new_regulations_30d,
          open_obligations: parsed.open_obligations,
          critical_maps: parsed.critical_maps,
        };
        if (
          kpiResult.new_regulations_30d === undefined ||
          kpiResult.open_obligations === undefined ||
          kpiResult.critical_maps === undefined
        ) {
          const [regRes, oblRes, mapRes] = await Promise.all([
            supabase.from("regulatory_changes").select("id").gte("created_at", THIRTY_DAYS_AGO),
            supabase.from("obligations").select("id, status"),
            supabase.from("map_cards").select("id, status, priority"),
          ]);
          if (kpiResult.new_regulations_30d === undefined) {
            kpiResult.new_regulations_30d = (regRes.data ?? []).length;
          }
          if (kpiResult.open_obligations === undefined) {
            const ob = (oblRes.data ?? []) as { status: string }[];
            kpiResult.open_obligations = ob.filter((o) => o.status !== "compliant").length;
          }
          if (kpiResult.critical_maps === undefined) {
            const maps = (mapRes.data ?? []) as { status: string; priority: string }[];
            kpiResult.critical_maps = maps.filter((m) => m.priority === "critical" && m.status !== "completed").length;
          }
        }
      }

      setHeroMetrics(applyHeroFromKpis(kpiResult));

      setKpis([
        {
          title: "Total Obligations",
          value: kpiResult.total_obligations.toLocaleString(),
          change: `${kpiResult.overdue_count} overdue`,
          changeType: kpiResult.overdue_count > 0 ? "negative" : "positive",
          icon: "Scale",
        },
        {
          title: "Compliance Score",
          value: `${Number(kpiResult.compliance_score).toFixed(1)}%`,
          change: kpiResult.compliance_score >= 90 ? "Above threshold" : "Below threshold",
          changeType: kpiResult.compliance_score >= 90 ? "positive" : "negative",
          icon: "ShieldCheck",
        },
        {
          title: "Pending MAPs",
          value: kpiResult.pending_maps.toString(),
          change: `${kpiResult.high_risk_count} high risk`,
          changeType: kpiResult.high_risk_count > 0 ? "negative" : "positive",
          icon: "GitBranch",
        },
        {
          title: "Documents Processed",
          value: kpiResult.docs_processed.toString(),
          change: "All time",
          changeType: "positive",
          icon: "FileText",
        },
      ]);

      const [
        activityDataRes,
        agentEvRes,
        auditAiRes,
        riskDataRes,
        trendDataRes,
        pendingPdfDocsRes,
        pendingRegsRes,
        runningRunsRes,
        dupChangesRes,
        coordRunsRes,
      ] = await Promise.all([
        supabase.from("audit_trail").select("*").order("created_at", { ascending: false }).limit(5),
        supabase
          .from("agent_events")
          .select("id, type, message, payload, created_at")
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMITS[activityLogMode].agent),
        supabase
          .from("audit_trail")
          .select("id, action, actor, details, target, created_at")
          .in("action", ["regulation_detected", "map_generated", "map_validated", "agent_run"])
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMITS[activityLogMode].audit),
        supabase.from("risk_scores").select("*").order("score", { ascending: true }),
        supabase.from("compliance_trends").select("*").order("recorded_at", { ascending: true }),
        supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .in("status", ["queued", "processing"])
          .eq("mime_type", "application/pdf"),
        supabase
          .from("regulatory_changes")
          .select("id", { count: "exact", head: true })
          .in("status", ["detected", "processing"])
          .is("document_id", null),
        supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("status", "running"),
        supabase.from("regulatory_changes").select("id", { count: "exact", head: true }).eq("status", "duplicate"),
        supabase
          .from("agent_runs")
          .select("id, stats, status, started_at, finished_at, summary")
          .eq("agent", "coordinator")
          .order("started_at", { ascending: false })
          .limit(24),
      ]);

      if (activityDataRes.error) throw new Error(activityDataRes.error.message);

      const pdfDocQ = pendingPdfDocsRes.count ?? 0;
      const regQ = pendingRegsRes.count ?? 0;
      const runningC = runningRunsRes.count ?? 0;
      const dupC = dupChangesRes.count ?? 0;
      const cruns = coordRunsRes.data as CoordRunRow[] | null;
      const deferred = computeDeferredFromCoordRows(cruns);
      setQueueMetrics({
        pendingPDFs: regQ + pdfDocQ,
        pdfDocumentQueue: pdfDocQ,
        processing: runningC,
        deferred,
        duplicatesSkipped: dupC,
      });
      setLiveCoordinatorRun(deriveLiveCoordinatorRun(cruns));

      setRecentActivity(
        (activityDataRes.data ?? []).map((row: Record<string, unknown>) => ({
          id: row.id as string,
          actor: row.actor as string,
          action: row.details as string,
          target: row.target as string,
          timestamp: formatRelativeTime(row.created_at as string),
          type: mapAuditActionToActivityType(String(row.action)),
        }))
      );

      if (agentEvRes.error && process.env.NODE_ENV === "development") {
        console.warn("[useDashboard] agent_events:", agentEvRes.error.message);
      }
      if (auditAiRes.error && process.env.NODE_ENV === "development") {
        console.warn("[useDashboard] audit AI filter:", auditAiRes.error.message);
      }

      setAiActivityFeed(
        mergeActivityFeed(
          (agentEvRes.data ?? []) as Record<string, unknown>[],
          (auditAiRes.data ?? []) as Record<string, unknown>[],
          activityLogMode,
        ),
      );

      if (riskDataRes.error) throw new Error(riskDataRes.error.message);

      setRiskScores(
        (riskDataRes.data ?? []).map((row: Record<string, unknown>) => {
          const score = row.score as number;
          return {
            department: row.department as string,
            score,
            trend: row.trend as "up" | "down" | "stable",
            overdueCount: row.overdue_count as number,
            riskBand: scoreToOperationalRiskBand(score),
          };
        })
      );

      if (trendDataRes.error) throw new Error(trendDataRes.error.message);

      setComplianceTrends(
        (trendDataRes.data ?? []).map((row: Record<string, unknown>) => ({
          month: row.month as string,
          score: row.score as number,
          obligations: row.obligations as number,
          resolved: row.resolved as number,
        }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard data");
    } finally {
      initialDashboardFetchDoneRef.current = true;
      setIsLoading(false);
    }
  }, [applyHeroFromKpis, activityLogMode]);

  const fetchActivitySnapshot = useCallback(async () => {
    const L = ACTIVITY_LIMITS[activityLogMode];
    try {
      const [agentEvRes, auditAiRes, pendingPdfDocsRes, pendingRegsRes, runningRunsRes, dupChangesRes, coordRunsRes] =
        await Promise.all([
          supabase
            .from("agent_events")
            .select("id, type, message, payload, created_at")
            .order("created_at", { ascending: false })
            .limit(L.agent),
          supabase
            .from("audit_trail")
            .select("id, action, actor, details, target, created_at")
            .in("action", ["regulation_detected", "map_generated", "map_validated", "agent_run"])
            .order("created_at", { ascending: false })
            .limit(L.audit),
          supabase
            .from("documents")
            .select("id", { count: "exact", head: true })
            .in("status", ["queued", "processing"])
            .eq("mime_type", "application/pdf"),
          supabase
            .from("regulatory_changes")
            .select("id", { count: "exact", head: true })
            .in("status", ["detected", "processing"])
            .is("document_id", null),
          supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("status", "running"),
          supabase.from("regulatory_changes").select("id", { count: "exact", head: true }).eq("status", "duplicate"),
          supabase
            .from("agent_runs")
            .select("id, stats, status, started_at, finished_at, summary")
            .eq("agent", "coordinator")
            .order("started_at", { ascending: false })
            .limit(24),
        ]);

      if (agentEvRes.error && process.env.NODE_ENV === "development") {
        console.warn("[useDashboard] agent_events poll:", agentEvRes.error.message);
      }
      if (auditAiRes.error && process.env.NODE_ENV === "development") {
        console.warn("[useDashboard] audit poll:", auditAiRes.error.message);
      }

      const pdfDocQ = pendingPdfDocsRes.count ?? 0;
      const regQ = pendingRegsRes.count ?? 0;
      const runningC = runningRunsRes.count ?? 0;
      const dupC = dupChangesRes.count ?? 0;
      const cruns = coordRunsRes.data as CoordRunRow[] | null;
      setQueueMetrics({
        pendingPDFs: regQ + pdfDocQ,
        pdfDocumentQueue: pdfDocQ,
        processing: runningC,
        deferred: computeDeferredFromCoordRows(cruns),
        duplicatesSkipped: dupC,
      });
      setLiveCoordinatorRun(deriveLiveCoordinatorRun(cruns));
      setAiActivityFeed(
        mergeActivityFeed(
          (agentEvRes.data ?? []) as Record<string, unknown>[],
          (auditAiRes.data ?? []) as Record<string, unknown>[],
          activityLogMode,
        ),
      );
    } catch {
      /* keep prior feed on transient poll errors */
    }
  }, [activityLogMode]);

  useEffect(() => {
    const processing = queueMetrics?.processing ?? 0;
    if (processing <= 0) return;
    const id = window.setInterval(() => {
      void fetchActivitySnapshot();
    }, 2000);
    return () => window.clearInterval(id);
  }, [queueMetrics?.processing, fetchActivitySnapshot]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedFetch = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        fetchAll();
      }, 500);
    };

    const channel = supabase
      .channel("dashboard-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "obligations" }, debouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "map_cards" }, debouncedFetch)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_trail" }, debouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "risk_scores" }, debouncedFetch)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "agent_events" }, debouncedFetch)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "regulatory_changes" }, debouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_runs" }, debouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, debouncedFetch)
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchAll]);

  return {
    kpis,
    heroMetrics,
    aiActivityFeed,
    queueMetrics,
    liveCoordinatorRun,
    recentActivity,
    riskScores,
    complianceTrends,
    isLoading,
    error,
    refetch: fetchAll,
  };
}

function formatClock(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

function formatRelativeTime(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} hr ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}

function mapAuditActionToActivityType(action: string): ActivityItem["type"] {
  if (action.includes("upload")) return "upload";
  if (action.includes("process") || action.includes("extract")) return "extraction";
  if (action.includes("review") || action.includes("closed")) return "approval";
  if (action.includes("risk") || action.includes("alert")) return "escalation";
  return "review";
}

function payloadDetail(pay: Record<string, unknown> | undefined, verbose: boolean): string | undefined {
  if (!verbose || !pay || typeof pay !== "object") return undefined;
  const parts: string[] = [];
  if (typeof pay.feed_url === "string") parts.push(`Feed URL: ${pay.feed_url}`);
  if (typeof pay.pdf_url === "string") parts.push(`PDF URL: ${(pay.pdf_url as string).slice(0, 200)}`);
  if (typeof pay.ref === "string") parts.push(`Ref: ${pay.ref}`);
  if (typeof pay.agent === "string") parts.push(`Agent key: ${pay.agent}`);
  if (Array.isArray(pay.sub_agents)) parts.push(`Sub-agents: ${JSON.stringify(pay.sub_agents).slice(0, 120)}`);
  if (parts.length === 0) {
    const keys = Object.keys(pay).filter((k) => !["organization_id"].includes(k));
    if (keys.length) {
      parts.push(
        keys
          .slice(0, 5)
          .map((k) => {
            const v = pay[k];
            const s = typeof v === "string" ? v : JSON.stringify(v);
            return `${k}=${s.slice(0, 72)}`;
          })
          .join(" · "),
      );
    }
  }
  const s = parts.join(" · ");
  if (!s) return undefined;
  return s.length > 320 ? `${s.slice(0, 317)}…` : s;
}

function narrativeFromAgentEvent(
  row: {
    id: string;
    type: string;
    message: string;
    created_at: string;
    payload?: Record<string, unknown>;
  },
  verbose = false,
): AiActivityItem | null {
  const msg = row.message?.trim() || "";
  const t = row.type;
  const pay = row.payload;
  let line = "";
  let tone: AiActivityItem["tone"] = "info";

  if (t === "change_detected" && msg) {
    line = `AI Monitoring Agent detected a regulatory update: ${msg}`;
    tone = "success";
  } else if (t === "duplicate_pdf_skipped" && msg) {
    line = `Duplicate PDF skipped (checksum match) — ${msg}`;
    tone = "warning";
  } else if (t === "pdf_ingested" && msg) {
    line = `PDF ingested for extraction: ${msg}`;
    tone = "success";
  } else if (t === "pdf_resolved" && msg) {
    line = `PDF link resolved from notification: ${msg}`;
    tone = "info";
  } else if (t === "pdf_needs_ocr" && msg) {
    line = `PDF needs OCR (low text): ${msg}`;
    tone = "warning";
  } else if (t === "pdf_download_failed" && msg) {
    line = `PDF download failed: ${msg}`;
    tone = "error";
  } else if (t === "map_generated" && msg) {
    const dept = typeof pay?.department === "string" ? ` → ${pay.department}` : "";
    line = `MAP generated${dept}: ${msg}`;
    tone = "success";
  } else if (t === "map_validated" && msg) {
    line = `AI Validation Agent reviewed evidence: ${msg}`;
    tone = "success";
  } else if (t === "readiness_recomputed" && msg) {
    line = `AI Validation Agent updated readiness scores for ${msg}`;
    tone = "success";
  } else if (t === "info" && /deferred/i.test(msg)) {
    line = `Queue: ${msg}`;
    tone = "warning";
  } else if (t === "info" && msg) {
    line = msg.startsWith("No new") ? `Pipeline: ${msg}` : `Info: ${msg}`;
    tone = "info";
  } else if (t === "error" && msg) {
    line = `Automation alert: ${msg}`;
    tone = "error";
  } else if (t === "sub_agent") {
    if (/MonitoringAgent/i.test(msg)) {
      line = msg.replace(/^MonitoringAgent:?\s*/i, "AI Monitoring Agent — ");
      tone = "info";
    } else if (/EvidenceAgent/i.test(msg)) {
      line = msg.replace(/^EvidenceAgent:?\s*/i, "AI Validation Agent — ");
      tone = "info";
    } else if (/DriftAgent/i.test(msg)) {
      line = msg.replace(/^DriftAgent:?\s*/i, "AI Regulatory Change Analysis — ");
      tone = "info";
    } else if (/ImpactAgent/i.test(msg)) {
      line = msg.replace(/^ImpactAgent:?\s*/i, "AI Compliance Impact Analysis — ");
      tone = "info";
    } else if (/AuditAgent/i.test(msg)) {
      line = msg.replace(/^AuditAgent:?\s*/i, "AI Audit Agent — ");
      tone = "info";
    } else if (msg) {
      line = msg;
      tone = "info";
    } else if (pay && typeof pay.agent === "string") {
      line = `Sub-agent (${pay.agent})`;
      tone = "info";
    }
  } else if (t === "coordinator" && msg) {
    line = `Coordinator: ${msg}`;
    tone = "info";
  } else if (msg) {
    line = `${t}: ${msg}`;
    tone = "info";
  }

  if (!line) return null;
  const detail = payloadDetail(pay, verbose);
  return { id: row.id, line, timestamp: row.created_at, tone, ...(detail ? { detail } : {}) };
}

function narrativeFromAuditRow(row: {
  id: string;
  action: string;
  details: string;
  actor: string;
  created_at: string;
}): AiActivityItem | null {
  const d = row.details?.trim() || "";
  let line = "";
  let tone: AiActivityItem["tone"] = "info";
  switch (row.action) {
    case "regulation_detected":
      line = d ? `AI Monitoring Agent: ${d}` : "AI Monitoring Agent reported new regulatory activity.";
      tone = "success";
      break;
    case "map_generated":
      line = d ? `AI Routing / MAP pipeline: ${d}` : "AI agents generated new MAPs from obligations.";
      tone = "success";
      break;
    case "map_validated":
      line = d ? `AI Validation Agent: ${d}` : "AI Validation Agent updated MAP compliance status.";
      tone = "success";
      break;
    case "agent_run":
      line = d ? `Automation run: ${d}` : "Compliance automation completed a run.";
      tone = "info";
      break;
    default:
      return null;
  }
  return { id: row.id, line, timestamp: row.created_at, tone };
}
