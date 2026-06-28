"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader } from "@/components/ui/glass-card";
import { useMapBoard } from "@/hooks/use-map-board";
import { CardSkeleton, ErrorState } from "@/components/ui/loading-states";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { MAPCard as MAPCardType } from "@/types";
import {
  Calendar, MessageSquare, AlertTriangle, User, Plus,
  X, Save, Loader2, Trash2, Edit2, Bot, CheckCircle, ShieldX, UserPlus,
  History,
} from "lucide-react";
import { AiDecisionCallout } from "@/components/ui/ai-decision-callout";
import { cn } from "@/lib/utils";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { usePrincipal } from "@/hooks/use-principal";
import { hasPrincipalPermission } from "@/lib/auth/permissions";
import { mapColumnIdToDbStatus, type MapUIColumnId } from "@/lib/map-lifecycle";

// ── Card Create/Edit Modal ────────────────────────────────────────────────────
interface CardForm { title: string; owner: string; due_date: string; priority: string; description: string; }
interface CardModalProps { open: boolean; onClose: () => void; onSave: () => void; editId?: string | null; columnId?: string; initialData?: Partial<CardForm>; }

function CardModal({ open, onClose, onSave, editId, columnId, initialData }: CardModalProps) {
  const api = useTenantApi();
  const isEdit = Boolean(editId);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CardForm>(() => ({
    title: "",
    owner: "Compliance Team",
    due_date: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
    priority: "medium",
    description: "",
    ...initialData,
  }));
  const set = (f: keyof CardForm) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>) => setForm(p => ({ ...p, [f]: e.target.value }));
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) { toast.error("Title required"); return; }
    setSaving(true);
    try {
      const url = isEdit ? `/api/map-cards/${editId}` : "/api/map-cards";
      const body = isEdit ? form : { ...form, status: mapColumnIdToDbStatus((columnId ?? "approved") as MapUIColumnId) };
      const res = await api(url, { method: isEdit ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const err = await res.json(); throw new Error(err.error ?? "Failed"); }
      toast.success(isEdit ? "MAP card updated" : "MAP card created");
      onSave(); onClose();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };
  if (!open) return null;
  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }}
            className="relative z-10 w-full max-w-lg bg-[#0a1929] border border-[#424655]/40 rounded-2xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.06]">
              <h2 className="text-base font-semibold text-[#d4e4fa]">{isEdit ? "Edit MAP Card" : "New MAP Card"}</h2>
              <button onClick={onClose} className="text-[#8c90a1] hover:text-[#d4e4fa]"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Title *</label>
                <Input value={form.title} onChange={set("title")} placeholder="e.g. Submit Q1 Capital Report" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Description</label>
                <textarea value={form.description} onChange={set("description")} rows={2} placeholder="Additional notes..." className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2 placeholder:text-[#8c90a1]/60 focus:outline-none focus:border-[#b0c6ff]/40 resize-none" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Owner</label>
                  <Input value={form.owner} onChange={set("owner")} placeholder="e.g. John Smith" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Due Date</label>
                  <Input type="date" value={form.due_date} onChange={set("due_date")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5">Priority</label>
                <select value={form.priority} onChange={set("priority")} className="w-full rounded-lg bg-[#0d1c2d] border border-[#424655]/30 text-[#d4e4fa] text-sm px-3 py-2 focus:outline-none focus:border-[#b0c6ff]/40">
                  {["critical","high","medium","low"].map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/[0.06]">
                <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[#8c90a1] hover:text-[#d4e4fa]">Cancel</button>
                <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] text-sm font-semibold hover:bg-[#b0c6ff]/90 disabled:opacity-50">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isEdit ? "Save" : "Create"}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── MAP Card Component ────────────────────────────────────────────────────────
const priorityColors: Record<string, string> = { high: "border-l-red-400", medium: "border-l-amber-400", low: "border-l-slate-400", critical: "border-l-red-500" };

function isMapOverdue(card: MAPCardType): boolean {
  if (card.status === "completed" || card.status === "rejected") return false;
  const due = new Date(card.dueDate);
  const today = new Date();
  due.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  return due < today;
}

const TEAM_SELECT_STATUSES: MAPCardType["status"][] = [
  "approved",
  "assigned",
  "in-progress",
  "under-review",
  "escalated",
];

type ActivityRow = { id: string; summary: string; event_type: string; created_at: string };

function MapCardActivityLog({ cardId }: { cardId: string }) {
  const api = useTenantApi();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api(`/api/map-cards/${cardId}/activity`);
        const data = res.ok ? ((await res.json()) as ActivityRow[]) : [];
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, cardId, api]);

  return (
    <div className="mt-2 border-t border-white/[0.06] pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-[#8c90a1] hover:text-[#b0c6ff] transition-colors"
      >
        <History className="w-3 h-3" />
        {open ? "Hide activity" : "Activity timeline"}
      </button>
      {open ? (
        <div className="mt-2 max-h-40 overflow-y-auto space-y-1.5 pr-1 text-left">
          {loading ? (
            <p className="text-[10px] text-[#8c90a1]">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-[10px] text-[#8c90a1]">No activity recorded yet.</p>
          ) : (
            rows.map((r) => (
              <div key={r.id} className="text-[10px] text-[#8c90a1] leading-snug border-l border-[#424655]/50 pl-2">
                <span className="text-[#d4e4fa]/85">
                  {new Date(r.created_at).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" })}
                </span>
                <span className="text-[#6b7280] mx-1">·</span>
                <span className="text-[#b0c6ff]/70">[{r.event_type}]</span> {r.summary}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function MAPCardItem({ card, onEdit, onDelete, onDragStart, onDragEnd, onApprove, onReject, onAssignSelf, onAssignUser, onSetTeam, assignees, teams, currentUserId, canManage }: {
  card: MAPCardType;
  onEdit: (c: MAPCardType) => void;
  onDelete: (id: string) => void;
  onDragStart: (e: React.DragEvent<HTMLDivElement>, cardId: string, fromCol: string) => void;
  onDragEnd: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAssignSelf: (id: string) => void;
  onAssignUser: (id: string, userId: string) => void;
  onSetTeam: (id: string, teamId: string | null) => void;
  assignees: { user_id: string; full_name: string | null; email: string | null; team_id: string | null }[];
  teams: { id: string; name: string }[];
  currentUserId?: string | null;
  canManage: boolean;
}) {
  const teamMembers = card.teamId ? assignees.filter((u) => u.team_id === card.teamId) : [];
  const completedEvidence = card.evidence.filter(e => e.completed).length;
  const totalEvidence = card.evidence.length;

  const overdue = isMapOverdue(card);
  const critical = card.priority === "critical";

  const assignBody =
    card.assignmentRationale?.trim() ||
    (card.obligationTitle && card.ownerDepartment
      ? `Operational follow-up for “${card.obligationTitle}” under ${card.ownerDepartment}.`
      : null);

  return (
    <div
      draggable={canManage}
      onDragStart={e => canManage && onDragStart(e, card.id, card.status)}
      onDragEnd={onDragEnd}
      className={cn(
        "min-w-0 max-w-full rounded-lg p-4 border transition-all border-l-2 group",
        canManage ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        "bg-[#0d1c2d]/80 hover:border-[#b0c6ff]/20",
        priorityColors[card.priority] ?? "border-l-slate-400",
        critical && "bg-red-950/25 border-red-500/35",
        overdue && !critical && "bg-amber-950/20 border-amber-500/30",
        card.escalated && "ring-2 ring-red-500/45 shadow-[0_0_20px_-4px_rgba(239,68,68,0.35)]",
        overdue && !card.escalated && "ring-1 ring-amber-500/35",
        !overdue && !critical && !card.escalated && "border-[#424655]/20"
      )}
    >
      {["ai", "pipeline", "agent"].includes((card.generatedBy ?? "manual").toLowerCase()) && (
        <div className="mb-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#b0c6ff]/10 border border-[#b0c6ff]/30 text-[10px] font-semibold text-[#b0c6ff]">
          <Bot className="w-3 h-3" /> AI suggested
        </div>
      )}
      <div className="flex items-start justify-between gap-2 mb-2 min-w-0">
        <h4 className="min-w-0 flex-1 text-sm font-medium text-[#d4e4fa] leading-snug break-words pr-0">{card.title}</h4>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          {canManage ? (
            <>
              <button type="button" onClick={() => onEdit(card)} className="p-1 rounded text-[#8c90a1] hover:text-[#b0c6ff] hover:bg-[#273647]/50"><Edit2 className="w-3 h-3" /></button>
              <button type="button" onClick={() => onDelete(card.id)} className="p-1 rounded text-[#8c90a1] hover:text-amber-300 hover:bg-amber-500/10" title="Archive MAP (soft delete)"><Trash2 className="w-3 h-3" /></button>
            </>
          ) : null}
          {card.escalated && (
            <span title="Escalated" className="inline-flex">
              <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" aria-hidden />
            </span>
          )}
        </div>
      </div>
      {(overdue || critical) && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {critical && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40">Critical</span>
          )}
          {overdue && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-200 border border-amber-500/35">Overdue</span>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5 mb-2">
        {(card.status === "ai-generated" || card.status === "pending-approval") && canManage ? (
          <>
            <button
              type="button"
              onClick={() => onApprove(card.id)}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/25"
            >
              <CheckCircle className="w-3 h-3" /> Approve
            </button>
            <button
              type="button"
              onClick={() => onReject(card.id)}
              className="inline-flex items-center gap-1 rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] font-semibold text-red-200 hover:bg-red-500/20"
            >
              <ShieldX className="w-3 h-3" /> Reject
            </button>
          </>
        ) : null}
        {canManage && card.status === "approved" && currentUserId && !card.assignedTo ? (
          <button
            type="button"
            onClick={() => onAssignSelf(card.id)}
            className="inline-flex items-center gap-1 rounded-md border border-[#b0c6ff]/35 bg-[#b0c6ff]/10 px-2 py-1 text-[10px] font-semibold text-[#d4e4fa] hover:bg-[#b0c6ff]/20"
          >
            <UserPlus className="w-3 h-3" /> Assign to me
          </button>
        ) : null}
        {canManage && (card.status === "approved" || card.status === "assigned") && !card.teamId ? (
          <span className="text-[10px] text-amber-200/90 px-1.5 py-1 rounded border border-amber-500/25 bg-amber-500/10">
            Select a team, then assign an employee
          </span>
        ) : null}
        {canManage && (card.status === "approved" || card.status === "assigned") && card.teamId && teamMembers.length > 0 ? (
          <select
            className="max-w-[160px] rounded-md border border-[#424655]/50 bg-[#0d1c2d] text-[10px] text-[#d4e4fa] px-1 py-1"
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value;
              if (v) onAssignUser(card.id, v);
              e.target.selectedIndex = 0;
            }}
          >
            <option value="">Assign employee…</option>
            {teamMembers.map((u) => (
              <option key={u.user_id} value={u.user_id}>
                {(u.full_name || u.email || u.user_id).slice(0, 36)}
              </option>
            ))}
          </select>
        ) : null}
        {canManage && (card.status === "approved" || card.status === "assigned") && card.teamId && teamMembers.length === 0 ? (
          <span className="text-[10px] text-[#8c90a1]">No members in this team yet</span>
        ) : null}
        {card.assignedTo ? (
          <span className="text-[10px] text-[#8c90a1] px-1.5 py-1 rounded bg-[#273647]/40 border border-white/[0.06]">
            Assignee linked
          </span>
        ) : null}
        {canManage && teams.length > 0 && TEAM_SELECT_STATUSES.includes(card.status) ? (
          <select
            className="max-w-[160px] rounded-md border border-[#424655]/50 bg-[#0d1c2d] text-[10px] text-[#d4e4fa] px-1 py-1"
            value={card.teamId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onSetTeam(card.id, v.length ? v : null);
            }}
            title="Owning team for this MAP"
          >
            <option value="">Team…</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {(t.name || t.id).slice(0, 36)}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <p className="text-[11px] text-[#8c90a1] mb-1 line-clamp-3 leading-snug break-words" title={card.obligation}>
        {card.obligationTitle ? (
          <span className="text-[#d4e4fa]/90">Linked: {card.obligationTitle}</span>
        ) : (
          <span className="font-mono text-[#8c90a1]/80">Obligation id · {card.obligation.slice(0, 8)}…</span>
        )}
      </p>
      {assignBody ? (
        <AiDecisionCallout variant="assigned" department={card.ownerDepartment} className="mb-3">
          {assignBody}
        </AiDecisionCallout>
      ) : null}
      {totalEvidence > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider text-[#8c90a1] font-semibold">Evidence</span>
            <span className="text-xs text-[#8c90a1]">{completedEvidence}/{totalEvidence}</span>
          </div>
          <div className="flex gap-1">
            {card.evidence.map(ev => (
              <div key={ev.id} className={cn("h-1.5 flex-1 rounded-full", ev.completed ? "bg-emerald-400" : "bg-[#273647]")} />
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[#8c90a1]">
            <User className="w-3 h-3" /><span className="text-[11px]">{card.owner.split(" ")[0]}</span>
          </div>
          <div className="flex items-center gap-1 text-[#8c90a1]">
            <Calendar className="w-3 h-3" />
            <span className="text-[11px]">{new Date(card.dueDate).toLocaleDateString("en-IN",{day:"2-digit",month:"short"})}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[#8c90a1]">
          <MessageSquare className="w-3 h-3" /><span className="text-[11px]">{card.comments}</span>
        </div>
      </div>
      <MapCardActivityLog cardId={card.id} />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function MapBoardPage() {
  const api = useTenantApi();
  const { principal } = usePrincipal();
  const canManageMaps = principal ? hasPrincipalPermission(principal, "obligations.assign") : false;
  const { columns, isLoading, error, refetch, updateCardStatus, patchCard } = useMapBoard();
  const [modalOpen, setModalOpen] = useState(false);
  const [editCard, setEditCard] = useState<MAPCardType | null>(null);
  const [newCardColumn, setNewCardColumn] = useState<string>("approved");
  const [assignees, setAssignees] = useState<
    { user_id: string; full_name: string | null; email: string | null; team_id: string | null }[]
  >([]);
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/map-cards/assignees");
        if (!res.ok) return;
        const data = (await res.json()) as { user_id: string; full_name: string | null; email: string | null; team_id: string | null }[];
        if (!cancelled) setAssignees(Array.isArray(data) ? data : []);
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api("/api/admin/teams");
        if (!res.ok) return;
        const data = (await res.json()) as unknown;
        const list = Array.isArray(data) ? data : [];
        if (!cancelled) {
          setTeams(
            list
              .filter((t): t is { id: string; name: string } => t && typeof (t as { id?: string }).id === "string")
              .map((t) => ({ id: t.id, name: typeof t.name === "string" ? t.name : t.id })),
          );
        }
      } catch {
        /* optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const handleApprove = useCallback(
    async (id: string) => {
      const { error: err } = await patchCard(id, { status: "approved" });
      if (err) toast.error(err);
      else toast.success("MAP approved for execution");
    },
    [patchCard],
  );

  const handleReject = useCallback(
    async (id: string) => {
      const { error: err } = await patchCard(id, { status: "rejected" });
      if (err) toast.error(err);
      else toast.success("MAP rejected");
    },
    [patchCard],
  );

  const handleAssignSelf = useCallback(
    async (id: string) => {
      if (!principal?.userId) {
        toast.error("Not signed in");
        return;
      }
      const { error: err } = await patchCard(id, { assignedTo: principal.userId, status: "assigned" });
      if (err) toast.error(err);
      else toast.success("Assigned to you");
    },
    [patchCard, principal],
  );

  const handleAssignUser = useCallback(
    async (id: string, userId: string) => {
      const { error: err } = await patchCard(id, { assignedTo: userId, status: "assigned" });
      if (err) toast.error(err);
      else toast.success("Employee assigned");
    },
    [patchCard],
  );

  const handleSetTeam = useCallback(
    async (id: string, teamId: string | null) => {
      const card = columns.flatMap((c) => c.cards).find((x) => x.id === id);
      const fields: { teamId: string | null; assignedTo?: string | null } = { teamId };
      if (teamId && card?.assignedTo) {
        const m = assignees.find((a) => a.user_id === card.assignedTo);
        if (!m?.team_id || m.team_id !== teamId) fields.assignedTo = null;
      }
      const { error: err } = await patchCard(id, fields);
      if (err) toast.error(err);
      else toast.success(teamId ? "Team set on MAP" : "Team cleared");
    },
    [patchCard, columns, assignees],
  );

  // Drag state
  const dragCardId = useRef<string | null>(null);
  const dragFromCol = useRef<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  const columnColors: Record<string, string> = {
    "ai-generated": "text-slate-300",
    "pending-approval": "text-violet-300",
    approved: "text-cyan-300",
    assigned: "text-sky-300",
    "in-progress": "text-[#b0c6ff]",
    "under-review": "text-amber-400",
    completed: "text-emerald-400",
    rejected: "text-red-300",
    escalated: "text-red-500",
  };
  const columnDotColors: Record<string, string> = {
    "ai-generated": "bg-slate-400",
    "pending-approval": "bg-violet-500",
    approved: "bg-cyan-400",
    assigned: "bg-sky-500",
    "in-progress": "bg-[#b0c6ff]",
    "under-review": "bg-amber-400",
    completed: "bg-emerald-400",
    rejected: "bg-red-400",
    escalated: "bg-red-600",
  };

  const onDragStart = useCallback((_e: React.DragEvent, cardId: string, fromCol: string) => {
    dragCardId.current = cardId;
    dragFromCol.current = fromCol;
  }, []);

  const onDragEnd = useCallback(() => {
    dragCardId.current = null;
    dragFromCol.current = null;
    setDragOverCol(null);
  }, []);

  const onDragOver = useCallback((e: React.DragEvent, colId: string) => {
    e.preventDefault();
    setDragOverCol(colId);
  }, []);

  const onDrop = useCallback(async (e: React.DragEvent, targetCol: string) => {
    e.preventDefault();
    setDragOverCol(null);
    const cardId = dragCardId.current;
    const fromCol = dragFromCol.current;
    if (!cardId || fromCol === targetCol) return;
    const { error } = await updateCardStatus(cardId, targetCol as MAPCardType["status"]);
    if (error) toast.error(error);
    else toast.success("Card moved");
  }, [updateCardStatus]);

  const openNewCard = (columnId: string) => {
    setEditCard(null);
    setNewCardColumn(columnId);
    setModalOpen(true);
  };

  const openEditCard = (card: MAPCardType) => {
    setEditCard(card);
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!canManageMaps) {
      toast.error("Only managers can archive MAPs");
      return;
    }
    if (!confirm("Archive this MAP? It will be removed from the board but kept for compliance audit history.")) return;
    try {
      const res = await api(`/api/map-cards/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Archive failed");
      toast.success("MAP archived");
      refetch();
    } catch (err) { toast.error((err as Error).message); }
  };

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Compliance Action Board" description="Management Action Plans — track remediation workflows from obligation to evidence." />
        <ErrorState message={error} onRetry={refetch} />
      </div>
    );
  }

  const totalCards = columns.reduce((s, c) => s + c.cards.length, 0);
  const completedCards = columns.find(c => c.id === "completed")?.cards.length ?? 0;

  return (
    <>
      <CardModal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditCard(null); }}
        onSave={refetch}
        editId={editCard?.id}
        columnId={newCardColumn}
        initialData={editCard ? { title: editCard.title, owner: editCard.owner, due_date: editCard.dueDate, priority: editCard.priority } : undefined}
      />

      <div className="min-w-0 space-y-6">
        <PageHeader
          title="Compliance Action Board"
          description="AI suggests MAPs; managers govern — approve, assign, and track through validation. Drag to change status; validation runs on items in Under review."
          actions={
            <div className="flex items-center gap-2">
              <div className="text-xs text-[#8c90a1] px-3 py-1.5 rounded-lg bg-[#273647]/40 border border-[#424655]/30">
                {completedCards}/{totalCards} completed
              </div>
              <button onClick={() => openNewCard("approved")} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 transition-colors text-sm font-medium">
                <Plus className="w-4 h-4" /> New MAP
              </button>
            </div>
          }
        />

        <div className="-mx-1 min-w-0 space-y-1.5 px-1">
          <p className="text-[10px] text-[#8c90a1]/90">
            Scroll columns horizontally — use the bar above the board.
          </p>
          <div
            className="min-w-0 scale-y-[-1] overflow-x-auto overflow-y-hidden overscroll-x-contain pb-1 pt-0.5 [scrollbar-gutter:stable]"
            aria-label="MAP columns horizontal scroll"
          >
            <div className="flex w-max min-w-0 flex-nowrap gap-4 pr-1 scale-y-[-1]">
          {columns.map(column => (
            <div
              key={column.id}
              className="flex w-[min(18rem,calc(100vw-2.5rem))] shrink-0 flex-col sm:w-72"
              onDragOver={e => onDragOver(e, column.id)}
              onDrop={e => onDrop(e, column.id)}
            >
                <div className="mb-4 flex min-h-[2.5rem] items-start justify-between gap-2 px-1">
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", columnDotColors[column.id] ?? "bg-slate-500")} />
                  <h3
                    title={column.title}
                    className={cn(
                      "min-w-0 max-w-full flex-1 text-left text-xs font-semibold leading-snug break-words [overflow-wrap:anywhere]",
                      columnColors[column.id] ?? "text-[#8c90a1]",
                    )}
                  >
                    {column.title}
                  </h3>
                  <span className="shrink-0 text-xs text-[#8c90a1] bg-[#273647]/50 rounded-full px-2 py-0.5 tabular-nums">{column.cards.length}</span>
                </div>
                <button type="button" onClick={() => openNewCard(column.id)} className="shrink-0 text-[#8c90a1] hover:text-[#d4e4fa] transition-colors p-1 rounded hover:bg-[#273647]/50" aria-label={`Add card to ${column.title}`}>
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <div className={cn(
                "min-h-[200px] space-y-3 rounded-xl border p-3 transition-all duration-150 min-w-0",
                dragOverCol === column.id
                  ? "bg-[#b0c6ff]/[0.04] border-[#b0c6ff]/30"
                  : "bg-[#051424]/30 border-[#424655]/10"
              )}>
                {isLoading ? (
                  <><CardSkeleton /><CardSkeleton /></>
                ) : (
                  <>
                    {column.cards.map((card) => (
                      <MAPCardItem
                        key={card.id}
                        card={card}
                        onEdit={openEditCard}
                        onDelete={handleDelete}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        onAssignSelf={handleAssignSelf}
                        onAssignUser={handleAssignUser}
                        onSetTeam={handleSetTeam}
                        assignees={assignees}
                        teams={teams}
                        currentUserId={principal?.userId}
                        canManage={canManageMaps}
                      />
                    ))}
                    {column.cards.length === 0 && (
                      <div className="py-6 text-center text-xs text-[#8c90a1]/50 italic">
                        Drop cards here
                      </div>
                    )}
                  </>
                )}
                <button
                  onClick={() => openNewCard(column.id)}
                  className="w-full py-2.5 rounded-lg border border-dashed border-[#424655]/30 text-[#8c90a1] text-xs hover:border-[#b0c6ff]/30 hover:text-[#b0c6ff] transition-colors flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Card
                </button>
              </div>
            </div>
          ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
