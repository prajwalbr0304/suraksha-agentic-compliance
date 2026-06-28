"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { motion } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Node,
  type Edge,
  Handle,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "@dagrejs/dagre";
import {
  FileText,
  Scale,
  Building2,
  GitBranch,
  ShieldCheck,
  RefreshCw,
  Filter,
  Layers,
  ZoomIn,
  ScrollText,
  Users,
  User,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";

/** Traceability stack: regulation → … → evidence (enterprise explainability layer) */
const NODE_STYLES: Record<string, { bg: string; border: string; text: string; icon: React.ElementType; glow: string }> = {
  regulation: { bg: "#0c1929", border: "#3b82f6", text: "#93c5fd", icon: ScrollText, glow: "shadow-[0_0_14px_rgba(59,130,246,0.35)]" },
  document: { bg: "#111827", border: "#60a5fa", text: "#bfdbfe", icon: FileText, glow: "shadow-[0_0_12px_rgba(96,165,250,0.25)]" },
  obligation: { bg: "#1a1030", border: "#a855f7", text: "#d8b4fe", icon: Scale, glow: "shadow-[0_0_12px_rgba(168,85,247,0.35)]" },
  map_action: { bg: "#1c1107", border: "#eab308", text: "#fef08a", icon: GitBranch, glow: "shadow-[0_0_12px_rgba(234,179,8,0.4)]" },
  department: { bg: "#0f2418", border: "#22c55e", text: "#86efac", icon: Building2, glow: "shadow-[0_0_12px_rgba(34,197,94,0.3)]" },
  team: { bg: "#082f2e", border: "#06b6d4", text: "#a5f3fc", icon: Users, glow: "shadow-[0_0_12px_rgba(6,182,212,0.35)]" },
  employee: { bg: "#29130a", border: "#f97316", text: "#fdba74", icon: User, glow: "shadow-[0_0_12px_rgba(249,115,22,0.35)]" },
  evidence: { bg: "#18181b", border: "#e4e4e7", text: "#fafafa", icon: ShieldCheck, glow: "shadow-[0_0_10px_rgba(228,228,231,0.25)]" },
};

const HEAT_RING: Record<string, string> = {
  critical: "ring-2 ring-red-500/80 ring-offset-2 ring-offset-[#0a1929]",
  elevated: "ring-2 ring-amber-500/60 ring-offset-2 ring-offset-[#0a1929]",
  steady: "",
  complete: "ring-1 ring-emerald-500/50 ring-offset-1 ring-offset-[#0a1929]",
};

const PRIORITY_COLOR: Record<string, string> = {
  critical: "#ef4444",
  high: "#f97316",
  medium: "#fbbf24",
  low: "#4ade80",
};

function ComplianceNode({ data }: { data: Record<string, unknown> }) {
  const style = NODE_STYLES[(data.nodeType as string) ?? "document"] ?? NODE_STYLES.document;
  const Icon = style.icon;
  const priority = data.priority as string | undefined;
  const heat = (data.heat as string) ?? "steady";
  const aiSuggested = Boolean(data.aiSuggested);

  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 w-[200px] cursor-pointer transition-all duration-200 hover:scale-[1.02]",
        style.glow,
        HEAT_RING[heat] ?? "",
      )}
      style={{ background: style.bg, borderColor: style.border }}
    >
      <Handle type="target" position={Position.Left} style={{ background: style.border, width: 8, height: 8, border: "none" }} />
      <div className="flex items-start gap-2">
        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: style.text }} />
        <div className="min-w-0">
          <div className="flex items-center gap-1 flex-wrap mb-0.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: style.text }}>
              {(data.nodeType as string)?.replace(/_/g, " ")}
            </p>
            {aiSuggested ? (
              <span className="inline-flex items-center gap-0.5 rounded px-1 py-px bg-[#b0c6ff]/20 text-[8px] font-bold uppercase text-[#b0c6ff]">
                <Sparkles className="w-2.5 h-2.5" aria-hidden />
                AI
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-white/90 leading-tight font-medium break-words line-clamp-3" title={data.label as string}>
            {data.label as string}
          </p>
          {priority ? (
            <span
              className="inline-flex mt-1 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase"
              style={{
                color: PRIORITY_COLOR[priority] ?? "#fff",
                background: (PRIORITY_COLOR[priority] ?? "#fff") + "22",
              }}
            >
              {priority}
            </span>
          ) : null}
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: style.border, width: 8, height: 8, border: "none" }} />
    </div>
  );
}

const nodeTypes = { complianceNode: ComplianceNode };

interface RawNode {
  id: string;
  type: string;
  label: string;
  data: Record<string, unknown>;
}
interface RawEdge {
  id: string;
  source: string;
  target: string;
  label: string;
}

// Fixed layout footprint per node so dagre can space them without overlap.
const NODE_W = 216;
const NODE_H = 84;

function buildLayout(rawNodes: RawNode[], rawEdges: RawEdge[]): { nodes: Node[]; edges: Edge[] } {
  // Hierarchical left→right layout via dagre: minimises edge crossings and keeps
  // each layer in its own rank, so relationships read as clean, mostly-horizontal lines.
  const g = new dagre.graphlib.Graph();
  g.setGraph({
    rankdir: "LR",
    align: "UL",
    ranksep: 130,
    nodesep: 36,
    edgesep: 24,
    ranker: "tight-tree",
    marginx: 24,
    marginy: 24,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const validIds = new Set(rawNodes.map((n) => n.id));
  rawNodes.forEach((n) => {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
  });
  rawEdges.forEach((e) => {
    if (validIds.has(e.source) && validIds.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  });

  dagre.layout(g);

  const typeIndex = new Map(rawNodes.map((n) => [n.id, n.type]));
  const flowNodes: Node[] = rawNodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: "complianceNode",
      position: { x: (pos?.x ?? 0) - NODE_W / 2, y: (pos?.y ?? 0) - NODE_H / 2 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { ...n.data, label: n.label, nodeType: n.type },
    };
  });

  const flowEdges: Edge[] = rawEdges.map((e) => {
    const srcType = typeIndex.get(e.source);
    const stroke = (srcType && NODE_STYLES[srcType]?.border) || "#5b6478";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      type: "smoothstep",
      pathOptions: { borderRadius: 16 },
      animated: false,
      style: { stroke, strokeWidth: 1.4, strokeOpacity: 0.55 },
      labelStyle: { fill: "#8c90a1", fontSize: 9 },
      labelBgStyle: { fill: "#0a1929", fillOpacity: 0.85 },
      labelBgPadding: [3, 2] as [number, number],
      labelBgBorderRadius: 3,
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 13, height: 13 },
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

const FILTER_TYPES = [
  { key: "regulation", label: "Regulations", color: "#3b82f6" },
  { key: "document", label: "Documents", color: "#60a5fa" },
  { key: "obligation", label: "Obligations", color: "#a855f7" },
  { key: "map_action", label: "MAPs", color: "#eab308" },
  { key: "department", label: "Departments", color: "#22c55e" },
  { key: "team", label: "Teams", color: "#06b6d4" },
  { key: "employee", label: "People", color: "#f97316" },
  { key: "evidence", label: "Evidence", color: "#e4e4e7" },
];

export default function KnowledgeGraphPage() {
  const api = useTenantApi();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set(FILTER_TYPES.map((f) => f.key)));
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const rawRef = useRef<{ nodes: RawNode[]; edges: RawEdge[] }>({ nodes: [], edges: [] });
  const activeFiltersRef = useRef(activeFilters);
  const [layerCounts, setLayerCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    activeFiltersRef.current = activeFilters;
  }, [activeFilters]);

  const applyFilters = useCallback(
    (raw: { nodes: RawNode[]; edges: RawEdge[] }, filters: Set<string>) => {
      const filtered = raw.nodes.filter((n) => filters.has(n.type));
      const filteredIds = new Set(filtered.map((n) => n.id));
      const filteredEdges = raw.edges.filter((e) => filteredIds.has(e.source) && filteredIds.has(e.target));
      const { nodes: fn, edges: fe } = buildLayout(filtered, filteredEdges);
      setNodes(fn);
      setEdges(fe);
    },
    [setNodes, setEdges],
  );

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api("/api/knowledge-graph");
      const data = await res.json();
      rawRef.current = { nodes: data.nodes ?? [], edges: data.edges ?? [] };
      const counts: Record<string, number> = {};
      for (const n of rawRef.current.nodes) {
        counts[n.type] = (counts[n.type] ?? 0) + 1;
      }
      setLayerCounts(counts);
      const sum = data.summary ?? { nodes: 0, edges: 0 };
      setStats({ nodes: sum.nodes ?? 0, edges: sum.edges ?? 0 });
      applyFilters(rawRef.current, activeFiltersRef.current);
    } catch {
      toast.error("Failed to load knowledge graph");
    } finally {
      setLoading(false);
    }
  }, [api, applyFilters]);

  useEffect(() => {
    void fetchGraph();
  }, [fetchGraph]);

  useEffect(() => {
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        void fetchGraph();
      }, 1400);
    };

    const channel = supabase
      .channel("compliance-knowledge-graph")
      .on("postgres_changes", { event: "*", schema: "public", table: "map_cards" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "obligations" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "evidence" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "regulatory_changes" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" }, schedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, schedule)
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      void supabase.removeChannel(channel);
    };
  }, [fetchGraph]);

  const toggleFilter = (key: string) => {
    const next = new Set(activeFilters);
    if (next.has(key)) {
      if (next.size > 1) next.delete(key);
    } else next.add(key);
    setActiveFilters(next);
    applyFilters(rawRef.current, next);
  };

  return (
    <div className="space-y-5 h-full">
      <PageHeader
        title="Compliance Knowledge Graph"
        description="Explainability layer: regulations, documents, obligations, MAPs, org structure, owners, and evidence — with live updates as work progresses."
        actions={
          <button
            type="button"
            onClick={() => void fetchGraph()}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm"
          >
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      <p className="text-xs text-[#8c90a1] -mt-2">
        {stats.nodes} nodes · {stats.edges} relationships · AI suggests; this graph shows how suggestions connect to human-owned execution.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        {FILTER_TYPES.map((f) => {
          const count = layerCounts[f.key] ?? 0;
          const isActive = activeFilters.has(f.key);
          return (
            <motion.button
              key={f.key}
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => toggleFilter(f.key)}
              className={cn(
                "p-2.5 rounded-xl border text-left transition-all min-h-[72px]",
                isActive ? "border-opacity-60" : "border-[#424655]/20 opacity-45",
              )}
              style={{ background: f.color + "14", borderColor: f.color + (isActive ? "55" : "22") }}
            >
              <div className="text-base font-bold mb-0.5 tabular-nums" style={{ color: f.color }}>
                {count}
              </div>
              <div className="text-[10px] text-[#8c90a1] leading-tight">{f.label}</div>
            </motion.button>
          );
        })}
      </div>

      <GlassCard className="p-0 overflow-hidden" style={{ height: "74vh" }}>
        {loading ? (
          <div className="flex items-center justify-center h-full flex-col gap-3">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}>
              <Layers className="w-8 h-8 text-[#b0c6ff]" />
            </motion.div>
            <p className="text-sm text-[#8c90a1]">Building knowledge graph…</p>
          </div>
        ) : nodes.length === 0 ? (
          <div className="flex items-center justify-center h-full flex-col gap-3 text-[#8c90a1]">
            <ZoomIn className="w-10 h-10 opacity-40" />
            <p className="text-sm text-center max-w-md">
              No graph yet — run regulatory monitoring or upload documents so obligations and MAPs appear here.
            </p>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNode(node)}
            fitView
            fitViewOptions={{ padding: 0.18 }}
            minZoom={0.1}
            maxZoom={2}
            nodesDraggable
            elevateEdgesOnSelect
            defaultEdgeOptions={{ type: "smoothstep" }}
            style={{ background: "transparent" }}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1d2a3a" gap={26} size={1} />
            <Controls style={{ background: "#0a1929", border: "1px solid #424655", borderRadius: "8px" }} />
            <MiniMap
              style={{ background: "#0a1929", border: "1px solid #424655", borderRadius: "8px" }}
              nodeColor={(n) => {
                const type = (n.data?.nodeType as string) ?? "document";
                return NODE_STYLES[type]?.border ?? "#424655";
              }}
            />
          </ReactFlow>
        )}
      </GlassCard>

      {selectedNode ? (
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="fixed right-6 top-24 w-80 max-w-[calc(100vw-3rem)] z-40"
        >
          <GlassCard className="p-5 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-[#d4e4fa]">Traceability</h4>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="text-[#8c90a1] hover:text-[#d4e4fa] text-xs px-2 py-1 rounded bg-[#273647]/40"
              >
                Close
              </button>
            </div>
            <div className="space-y-2.5 text-sm">
              <div>
                <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Type</span>
                <p className="text-[#d4e4fa] mt-0.5 capitalize">{(selectedNode.data?.nodeType as string)?.replace(/_/g, " ")}</p>
              </div>
              <div>
                <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Title / label</span>
                <p className="text-[#d4e4fa] mt-0.5 leading-snug">{selectedNode.data?.label as string}</p>
              </div>
              {Boolean(selectedNode.data?.entityId) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Record id</span>
                  <p className="text-[11px] font-mono text-[#b0c6ff]/90 mt-0.5 break-all">{String(selectedNode.data.entityId)}</p>
                </div>
              )}
              {Boolean(selectedNode.data?.regulation) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Regulation ref</span>
                  <p className="text-xs text-[#d4e4fa] mt-0.5 leading-snug">{String(selectedNode.data.regulation)}</p>
                </div>
              )}
              {Boolean(selectedNode.data?.regulator) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Regulator</span>
                  <p className="text-xs text-[#d4e4fa] mt-0.5">{String(selectedNode.data.regulator)}</p>
                </div>
              )}
              {Boolean(selectedNode.data?.priority) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Priority</span>
                  <p
                    className="mt-0.5 capitalize font-semibold"
                    style={{ color: PRIORITY_COLOR[String(selectedNode.data.priority)] ?? "#fff" }}
                  >
                    {String(selectedNode.data.priority)}
                  </p>
                </div>
              )}
              {Boolean(selectedNode.data?.status) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Status</span>
                  <p className="text-[#d4e4fa] mt-0.5 capitalize">{String(selectedNode.data.status).replace(/_/g, " ")}</p>
                </div>
              )}
              {Boolean(selectedNode.data?.dueDate) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Due</span>
                  <p className="text-[#d4e4fa] mt-0.5">{String(selectedNode.data.dueDate)}</p>
                </div>
              )}
              {Boolean(selectedNode.data?.email) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Email</span>
                  <p className="text-xs text-[#d4e4fa] mt-0.5 break-all">{String(selectedNode.data.email)}</p>
                </div>
              )}
              {Boolean(selectedNode.data?.approvalStatus) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Evidence review</span>
                  <p className="text-xs text-[#d4e4fa] mt-0.5 capitalize">{String(selectedNode.data.approvalStatus)}</p>
                </div>
              )}
              {Boolean(selectedNode.data?.confidence) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">AI confidence</span>
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1.5 rounded-full bg-[#273647]">
                      <div
                        className="h-full rounded-full bg-[#b0c6ff]"
                        style={{ width: `${Number(selectedNode.data.confidence)}%` }}
                      />
                    </div>
                    <span className="text-xs text-[#8c90a1] tabular-nums">{Number(selectedNode.data.confidence)}%</span>
                  </div>
                </div>
              )}
              {Boolean(selectedNode.data?.risk) && (
                <div>
                  <span className="text-[10px] uppercase text-[#8c90a1] font-semibold tracking-wider">Compliance risk</span>
                  <p className="text-xs text-[#d4e4fa] mt-0.5">{String(selectedNode.data.risk)}</p>
                </div>
              )}
            </div>
          </GlassCard>
        </motion.div>
      ) : null}

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-[#8c90a1] shrink-0" />
        <span className="text-xs text-[#8c90a1]">
          Toggle layers to focus the graph · Click a node for metadata · Refreshes on MAP, obligation, document, evidence,
          regulatory change, team, and department updates (Supabase Realtime where enabled).
        </span>
      </div>
    </div>
  );
}
