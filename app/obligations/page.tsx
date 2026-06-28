"use client";

import { useState, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader, GlassCard, StatusBadge, ConfidenceBadge } from "@/components/ui/glass-card";
import { AiDecisionCallout } from "@/components/ui/ai-decision-callout";
import { pickObligationDetectionBody } from "@/lib/ai-explainability";
import { useObligations } from "@/hooks/use-obligations";
import { TableRowSkeleton, ErrorState } from "@/components/ui/loading-states";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Search, Download, ChevronDown, ChevronRight, ExternalLink,
  Plus, Edit2, Trash2, Loader2, X, Save, ShieldAlert,
  Calendar, Building2, Tag, FileText,
} from "lucide-react";
import type { Obligation } from "@/types";
import { cn } from "@/lib/utils";
import { useTenantApi } from "@/contexts/tenant-api-context";

const statusVariant = (status: string) => {
  switch (status) {
    case "active": return "info";
    case "pending": return "warning";
    case "overdue": return "error";
    case "completed": return "success";
    default: return "default";
  }
};
const priorityVariant = (priority: string) => {
  switch (priority) {
    case "high": return "error";
    case "medium": return "warning";
    default: return "default";
  }
};

const STATUS_OPTIONS = ["in_progress","compliant","at_risk","overdue","pending_review"];
const PRIORITY_OPTIONS = ["critical","high","medium","low"];
const DEPT_OPTIONS = ["Compliance","Finance","IT","Risk","Legal","Operations","HR","Audit"];

interface FormData {
  title: string; description: string; regulation: string; jurisdiction: string;
  department: string; owner: string; status: string; priority: string; due_date: string; tags: string;
}

interface ObligationModalProps {
  open: boolean; onClose: () => void; onSave: () => void; editId?: string | null; initialData?: Partial<FormData>;
}

function ObligationModal({ open, onClose, onSave, editId, initialData }: ObligationModalProps) {
  const api = useTenantApi();
  const isEdit = Boolean(editId);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<FormData>({
    title: "", description: "", regulation: "", jurisdiction: "India",
    department: "Compliance", owner: "Compliance Team", status: "in_progress",
    priority: "medium", due_date: new Date(Date.now() + 90 * 86400000).toISOString().split("T")[0], tags: "",
    ...initialData,
  });
  useEffect(() => { if (initialData) setForm(f => ({ ...f, ...initialData })); }, [initialData]);
  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setIsSaving(true);
    try {
      const payload = { ...form, tags: form.tags ? form.tags.split(",").map(t => t.trim()).filter(Boolean) : [] };
      const url = isEdit ? `/api/obligations/${editId}` : "/api/obligations";
      const res = await api(url, { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Save failed"); }
      toast.success(isEdit ? "Obligation updated" : "Obligation created");
      onSave(); onClose();
    } catch (err) { toast.error((err as Error).message); }
    finally { setIsSaving(false); }
  };
  if (!open) return null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}
            className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-[#0a1929] border border-[#424655]/40 rounded-2xl shadow-2xl">
            <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-white/[0.06] bg-[#0a1929]">
              <h2 className="text-base font-semibold text-[#d4e4fa]">{isEdit ? "Edit Obligation" : "Create New Obligation"}</h2>
              <button onClick={onClose} className="p-1.5 rounded-lg text-[#8c90a1] hover:text-[#d4e4fa] hover:bg-[#273647]/50"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Title *</label>
                <Input value={form.title} onChange={set("title")} placeholder="e.g. Submit Monthly Capital Adequacy Report" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Description</label>
                <textarea value={form.description} onChange={set("description")} rows={3} placeholder="Full text of the regulatory obligation..."
                  className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2 placeholder:text-[#8c90a1]/60 focus:outline-none focus:border-[#b0c6ff]/40 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Regulation / Source</label>
                  <Input value={form.regulation} onChange={set("regulation")} placeholder="e.g. RBI Circular 2024-01" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Jurisdiction</label>
                  <Input value={form.jurisdiction} onChange={set("jurisdiction")} placeholder="e.g. India" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Department</label>
                  <select value={form.department} onChange={set("department")} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2 focus:outline-none focus:border-[#b0c6ff]/40">
                    {DEPT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Owner</label>
                  <Input value={form.owner} onChange={set("owner")} placeholder="e.g. John Smith" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Status</label>
                  <select value={form.status} onChange={set("status")} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2 focus:outline-none focus:border-[#b0c6ff]/40">
                    {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g," ")}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Priority</label>
                  <select value={form.priority} onChange={set("priority")} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2 focus:outline-none focus:border-[#b0c6ff]/40">
                    {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Due Date</label>
                  <Input type="date" value={form.due_date} onChange={set("due_date")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Tags / Citations (comma-separated)</label>
                <Input value={form.tags} onChange={set("tags")} placeholder="e.g. Section 3.1, BCBS 239, Art. 5" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
              </div>
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/[0.06]">
                <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[#8c90a1] hover:text-[#d4e4fa] hover:bg-[#273647]/30">Cancel</button>
                <button type="submit" disabled={isSaving} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-semibold hover:bg-[#b0c6ff]/90 disabled:opacity-50">
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isEdit ? "Save Changes" : "Create Obligation"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface EvidenceItem { id: string; title: string; collected_at: string | null; }

function EvidencePanel({ obligationId }: { obligationId: string }) {
  const api = useTenantApi();
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  useEffect(() => {
    api(`/api/evidence?obligation_id=${encodeURIComponent(obligationId)}`)
      .then(r => r.json()).then(d => { setItems(Array.isArray(d) ? d : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [obligationId, api]);
  const addEvidence = async () => {
    if (!newTitle.trim()) return;
    setAdding(true);
    try {
      const res = await api("/api/evidence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ obligation_id: obligationId, title: newTitle }) });
      if (!res.ok) throw new Error("Failed");
      const ev = await res.json();
      setItems(prev => [...prev, ev]); setNewTitle(""); setShowAdd(false); toast.success("Evidence added");
    } catch { toast.error("Failed to add evidence"); }
    finally { setAdding(false); }
  };
  const toggleCollected = async (ev: EvidenceItem) => {
    const collected = !ev.collected_at;
    try {
      const res = await api(`/api/evidence?id=${ev.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ collected }) });
      if (!res.ok) throw new Error("Failed");
      const updated = await res.json();
      setItems(prev => prev.map(e => e.id === ev.id ? updated : e));
    } catch { toast.error("Failed to update evidence"); }
  };
  if (loading) return <div className="text-xs text-[#8c90a1] py-2">Loading evidence...</div>;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wider text-[#8c90a1] font-semibold">Evidence Items</p>
        <button onClick={() => setShowAdd(!showAdd)} className="text-[10px] text-[#b0c6ff] hover:underline flex items-center gap-1"><Plus className="w-3 h-3" />Add</button>
      </div>
      {showAdd && (
        <div className="flex gap-2">
          <Input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Evidence item title..." className="h-7 text-xs bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" onKeyDown={e => e.key === "Enter" && addEvidence()} />
          <button onClick={addEvidence} disabled={adding} className="px-3 py-1 rounded text-xs bg-[#b0c6ff]/10 text-[#b0c6ff] border border-[#b0c6ff]/20 hover:bg-[#b0c6ff]/20 disabled:opacity-50">
            {adding ? <Loader2 className="w-3 h-3 animate-spin" /> : "Add"}
          </button>
        </div>
      )}
      {items.length === 0 ? (
        <p className="text-xs text-[#8c90a1] italic">No evidence items yet.</p>
      ) : (
        <div className="space-y-1">
          {items.map(ev => (
            <div key={ev.id} className="flex items-center gap-2">
              <button onClick={() => toggleCollected(ev)} className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors", ev.collected_at ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-400" : "border-[#424655]/40 hover:border-[#b0c6ff]/40")}>
                {ev.collected_at && <span className="text-[8px]">✓</span>}
              </button>
              <span className={cn("text-xs", ev.collected_at ? "text-emerald-400 line-through opacity-70" : "text-[#d4e4fa]")}>{ev.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ObligationsPage() {
  const api = useTenantApi();
  const { obligations, totalCount, isLoading, error, refetch } = useObligations();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<FormData> | undefined>();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredObligations = obligations.filter(obl => {
    const q = searchQuery.toLowerCase();
    const detectBody = pickObligationDetectionBody({
      source_quote: obl.sourceQuote,
      extraction_reason: obl.extractionReason,
      ai_explanation: obl.aiExplanation,
      description: obl.description,
    });
    const matchSearch =
      !q ||
      obl.title.toLowerCase().includes(q) ||
      obl.source.toLowerCase().includes(q) ||
      obl.department.toLowerCase().includes(q) ||
      obl.description.toLowerCase().includes(q) ||
      (obl.sourceQuote?.toLowerCase().includes(q) ?? false) ||
      (obl.extractionReason?.toLowerCase().includes(q) ?? false) ||
      (obl.aiExplanation?.toLowerCase().includes(q) ?? false) ||
      (detectBody?.toLowerCase().includes(q) ?? false);
    const matchStatus = statusFilter === "all" || obl.status === statusFilter;
    const matchPriority = priorityFilter === "all" || obl.priority === priorityFilter;
    return matchSearch && matchStatus && matchPriority;
  });

  const exportCsv = useCallback(() => {
    if (!filteredObligations.length) { toast.warning("No obligations to export"); return; }
    const headers = [
      "ID",
      "Reference",
      "Title",
      "Source",
      "Regulator",
      "Department",
      "Status",
      "Priority",
      "Confidence",
      "Due Date",
      "Citations",
      "Detected because (source / rationale)",
      "AI explanation",
    ];
    const rows = filteredObligations.map((o: Obligation) => {
      const detected = pickObligationDetectionBody({
        source_quote: o.sourceQuote,
        extraction_reason: o.extractionReason,
        ai_explanation: o.aiExplanation,
        description: o.description,
      });
      return [
        o.id,
        o.reference ?? "",
        `"${o.title.replace(/"/g, '""')}"`,
        `"${o.source.replace(/"/g, '""')}"`,
        o.regulator,
        o.department,
        o.status,
        o.priority,
        o.confidence,
        o.dueDate,
        `"${o.citations.join("; ").replace(/"/g, '""')}"`,
        `"${(detected ?? "").replace(/"/g, '""')}"`,
        `"${(o.aiExplanation ?? "").replace(/"/g, '""')}"`,
      ];
    });
    const csv = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `obligations-${new Date().toISOString().split("T")[0]}.csv`; link.click();
    URL.revokeObjectURL(url); toast.success(`Exported ${filteredObligations.length} obligations`);
  }, [filteredObligations]);

  const openCreate = () => { setEditId(null); setEditData(undefined); setModalOpen(true); };
  const openEdit = (obl: Obligation) => {
    setEditId(obl.id);
    setEditData({ title: obl.title, regulation: obl.source, jurisdiction: obl.regulator, department: obl.department, priority: obl.priority, due_date: obl.dueDate, tags: obl.citations.join(", "), owner: "Compliance Team", status: obl.status === "active" ? "in_progress" : obl.status === "completed" ? "compliant" : "pending_review" });
    setModalOpen(true);
  };
  const handleDelete = async (obl: Obligation) => {
    if (!confirm(`Delete "${obl.title}"? This will also delete linked MAP cards and evidence.`)) return;
    setDeletingId(obl.id);
    try {
      const res = await api(`/api/obligations/${obl.id}`, { method: "DELETE" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.error ?? "Delete failed"); }
      toast.success("Obligation deleted"); refetch();
    } catch (err) { toast.error((err as Error).message); }
    finally { setDeletingId(null); }
  };

  return (
    <>
      <ObligationModal open={modalOpen} onClose={() => setModalOpen(false)} onSave={refetch} editId={editId} initialData={editData} />
      <div className="space-y-6">
        <PageHeader
          title="Obligations Repository"
          description="AI-extracted and manually created regulatory obligations with full lifecycle management."
          actions={
            <div className="flex items-center gap-2">
              <button onClick={exportCsv} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#273647]/40 border border-[#424655]/30 text-[#d4e4fa] hover:border-[#b0c6ff]/30 transition-colors text-sm">
                <Download className="w-4 h-4" /> Export CSV
              </button>
              <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 transition-colors text-sm font-semibold">
                <Plus className="w-4 h-4" /> Add Obligation
              </button>
            </div>
          }
        />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Total", value: totalCount, color: "text-[#b0c6ff]" },
            { label: "Active", value: obligations.filter(o => o.status === "active").length, color: "text-[#b0c6ff]" },
            { label: "Overdue", value: obligations.filter(o => o.status === "overdue").length, color: "text-red-400" },
            { label: "Completed", value: obligations.filter(o => o.status === "completed").length, color: "text-emerald-400" },
          ].map(s => (
            <GlassCard key={s.label} className="p-3 flex items-center gap-3">
              <div><p className={cn("text-xl font-bold", s.color)}>{s.value}</p><p className="text-xs text-[#8c90a1]">{s.label}</p></div>
            </GlassCard>
          ))}
        </div>
        <GlassCard className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8c90a1]" />
              <Input placeholder="Search by title, source, department..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa] placeholder:text-[#8c90a1]/60" />
            </div>
            <div className="flex gap-1.5 flex-wrap items-center">
              <span className="text-xs text-[#8c90a1]">Status:</span>
              {["all","active","pending","overdue","completed"].map(s => (
                <button key={s} onClick={() => setStatusFilter(s)} className={cn("px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors border", statusFilter === s ? "bg-[#b0c6ff]/10 text-[#b0c6ff] border-[#b0c6ff]/30" : "text-[#8c90a1] border-transparent hover:border-[#424655]/30 hover:text-[#d4e4fa]")}>{s}</button>
              ))}
            </div>
            <div className="flex gap-1.5 flex-wrap items-center">
              <span className="text-xs text-[#8c90a1]">Priority:</span>
              {["all","high","medium","low"].map(p => (
                <button key={p} onClick={() => setPriorityFilter(p)} className={cn("px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors border", priorityFilter === p ? "bg-[#b0c6ff]/10 text-[#b0c6ff] border-[#b0c6ff]/30" : "text-[#8c90a1] border-transparent hover:border-[#424655]/30 hover:text-[#d4e4fa]")}>{p}</button>
              ))}
            </div>
          </div>
        </GlassCard>
        {error ? <ErrorState message={error} onRetry={refetch} /> : (
          <GlassCard className="p-0 overflow-hidden">
            <div className="grid grid-cols-12 gap-3 px-5 py-3 bg-[#0d1c2d]/50 border-b border-white/[0.06] text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">
              <div className="col-span-4">Obligation</div>
              <div className="col-span-2">Source</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-1">Priority</div>
              <div className="col-span-1">Conf.</div>
              <div className="col-span-1">Due</div>
              <div className="col-span-1">Dept</div>
              <div className="col-span-1 text-right">Actions</div>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {isLoading ? [...Array(5)].map((_,i) => <TableRowSkeleton key={i} cols={8} />) :
               filteredObligations.length === 0 ? (
                <div className="py-16 text-center">
                  <ShieldAlert className="w-10 h-10 text-[#8c90a1] mx-auto mb-3 opacity-40" />
                  <p className="text-[#8c90a1] text-sm mb-2">No obligations found.</p>
                  <button onClick={openCreate} className="text-[#b0c6ff] text-sm hover:underline">Create your first obligation →</button>
                </div>
              ) : filteredObligations.map((obl, i) => (
                <div key={obl.id}>
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.02 }}
                    className="grid grid-cols-12 gap-3 px-5 py-3.5 hover:bg-[#273647]/20 transition-colors items-center group">
                    <div className="col-span-4 flex items-center gap-2">
                      <button onClick={() => setExpandedRow(expandedRow === obl.id ? null : obl.id)} className="text-[#8c90a1] hover:text-[#d4e4fa] shrink-0">
                        <motion.div animate={{ rotate: expandedRow === obl.id ? 90 : 0 }}><ChevronRight className="w-4 h-4" /></motion.div>
                      </button>
                      <span className="text-sm text-[#d4e4fa] font-medium leading-tight">{obl.title}</span>
                    </div>
                    <div className="col-span-2 text-xs text-[#8c90a1] truncate">{obl.source}</div>
                    <div className="col-span-1"><StatusBadge status={obl.status} variant={statusVariant(obl.status) as "default"|"success"|"warning"|"error"|"info"} /></div>
                    <div className="col-span-1"><StatusBadge status={obl.priority} variant={priorityVariant(obl.priority) as "default"|"success"|"warning"|"error"|"info"} /></div>
                    <div className="col-span-1"><ConfidenceBadge confidence={obl.confidence} /></div>
                    <div className="col-span-1 text-xs text-[#8c90a1]">{obl.dueDate ? new Date(obl.dueDate).toLocaleDateString("en-IN",{day:"2-digit",month:"short"}) : "—"}</div>
                    <div className="col-span-1 text-xs text-[#8c90a1] truncate">{obl.department}</div>
                    <div className="col-span-1 flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEdit(obl)} className="p-1.5 rounded-lg text-[#8c90a1] hover:text-[#b0c6ff] hover:bg-[#273647]/50 transition-colors" title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                      <button onClick={() => handleDelete(obl)} disabled={deletingId === obl.id} className="p-1.5 rounded-lg text-[#8c90a1] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40" title="Delete">
                        {deletingId === obl.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </motion.div>
                  <AnimatePresence>
                    {expandedRow === obl.id && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                        <div className="px-6 py-5 bg-[#0d1c2d]/40 border-t border-white/[0.04]">
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-4">
                              <div className="flex items-center gap-2">
                                <Building2 className="w-4 h-4 text-[#8c90a1]" />
                                <div><p className="text-[10px] text-[#8c90a1] uppercase tracking-wider">Regulator</p><p className="text-sm text-[#d4e4fa]">{obl.regulator}</p></div>
                              </div>
                              <div className="flex items-center gap-2">
                                <Calendar className="w-4 h-4 text-[#8c90a1]" />
                                <div><p className="text-[10px] text-[#8c90a1] uppercase tracking-wider">Due Date</p><p className="text-sm text-[#d4e4fa]">{obl.dueDate ? new Date(obl.dueDate).toLocaleDateString("en-IN",{dateStyle:"long"}) : "Not set"}</p></div>
                              </div>
                              <div className="flex items-start gap-2">
                                <Tag className="w-4 h-4 text-[#8c90a1] mt-0.5" />
                                <div>
                                  <p className="text-[10px] text-[#8c90a1] uppercase tracking-wider mb-1">Citations</p>
                                  <div className="flex flex-wrap gap-1">
                                    {obl.citations.length > 0 ? obl.citations.map(c => (
                                      <span key={c} className="px-2 py-0.5 rounded bg-[#b0c6ff]/10 text-[#b0c6ff] text-xs border border-[#b0c6ff]/20 flex items-center gap-1">{c}<ExternalLink className="w-2.5 h-2.5" /></span>
                                    )) : <span className="text-xs text-[#8c90a1]">None</span>}
                                  </div>
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-2"><FileText className="w-4 h-4 text-[#8c90a1]" /><p className="text-[10px] text-[#8c90a1] uppercase tracking-wider">Obligation text</p></div>
                              <p className="text-sm text-[#d4e4fa]/90 leading-relaxed whitespace-pre-wrap">{obl.description?.trim() || obl.title}</p>
                              {(() => {
                                const explainBody =
                                  obl.sourceQuote?.trim() ||
                                  obl.extractionReason?.trim() ||
                                  obl.aiExplanation?.trim() ||
                                  null;
                                return explainBody ? (
                                  <AiDecisionCallout variant="detected" className="mt-3">
                                    {explainBody}
                                  </AiDecisionCallout>
                                ) : null;
                              })()}
                              <button onClick={() => openEdit(obl)} className="mt-3 flex items-center gap-1.5 text-xs text-[#b0c6ff] hover:underline"><Edit2 className="w-3 h-3" />Edit Obligation</button>
                            </div>
                            <div><EvidencePanel obligationId={obl.id} /></div>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
            {!isLoading && (
              <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between">
                <p className="text-xs text-[#8c90a1]">Showing {filteredObligations.length} of {totalCount} obligations</p>
                <div className="flex items-center gap-2 text-xs text-[#8c90a1]"><ChevronDown className="w-3.5 h-3.5" /></div>
              </div>
            )}
          </GlassCard>
        )}
      </div>
    </>
  );
}
