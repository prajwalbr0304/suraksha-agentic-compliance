"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { toast } from "sonner";
import {
  FileText,
  FileImage,
  File,
  Trash2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  Eye,
  Upload,
  Database,
  Calendar,
  Hash,
  Download,
} from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useTenantApi } from "@/contexts/tenant-api-context";

interface Document {
  id: string;
  name: string;
  size: number;
  mime_type: string;
  storage_path: string;
  status: "queued" | "processing" | "processed" | "failed";
  obligations_extracted: number;
  confidence_score: number;
  uploaded_by: string;
  uploaded_at: string;
  processed_at: string | null;
  metadata: Record<string, unknown>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function FileTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("image/")) return <FileImage className={className} />;
  if (mimeType === "application/pdf") return <FileText className={className} />;
  return <File className={className} />;
}

const statusConfig = {
  queued: { label: "Queued", icon: Clock, className: "bg-slate-500/10 text-slate-400 border-slate-500/30" },
  processing: { label: "Processing", icon: Loader2, className: "bg-[#b0c6ff]/10 text-[#b0c6ff] border-[#b0c6ff]/30" },
  processed: { label: "Processed", icon: CheckCircle2, className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" },
  failed: { label: "Failed", icon: AlertCircle, className: "bg-red-500/10 text-red-400 border-red-500/30" },
};

export function isRegulatoryFeedDoc(d: Document): boolean {
  const meta = d.metadata ?? {};
  if (meta.source === "agent") return true;
  if (d.uploaded_by === "ai-agent@suraksha") return true;
  if (typeof d.storage_path === "string" && d.storage_path.startsWith("agent/")) return true;
  return false;
}

export default function DocumentsPage() {
  const api = useTenantApi();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [docTab, setDocTab] = useState<"regulatory" | "uploaded">("regulatory");
  const [isLoading, setIsLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);

  const filteredDocs = useMemo(
    () =>
      documents.filter((d) => (docTab === "regulatory" ? isRegulatoryFeedDoc(d) : !isRegulatoryFeedDoc(d))),
    [documents, docTab]
  );

  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api("/api/documents");
      if (!res.ok) throw new Error("Failed to fetch documents");
      const data = await res.json();
      setDocuments(data);
    } catch (err) {
      toast.error("Failed to load documents");
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  useEffect(() => {
    if (selectedDoc && !filteredDocs.some((d) => d.id === selectedDoc.id)) {
      setSelectedDoc(null);
    }
  }, [filteredDocs, selectedDoc]);

  const handleDelete = useCallback(async (id: string, name: string) => {
    if (!confirm(`Delete "${name}" and all its extracted obligations?`)) return;
    setDeletingId(id);
    try {
      const res = await api(`/api/documents?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setDocuments((prev) => prev.filter((d) => d.id !== id));
      if (selectedDoc?.id === id) setSelectedDoc(null);
      toast.success(`Deleted "${name}"`);
    } catch {
      toast.error("Failed to delete document");
    } finally {
      setDeletingId(null);
    }
  }, [selectedDoc, api]);

  const totalDocs = filteredDocs.length;
  const processedDocs = filteredDocs.filter((d) => d.status === "processed").length;
  const totalObligations = filteredDocs.reduce((sum, d) => sum + (d.obligations_extracted ?? 0), 0);
  const failedDocs = filteredDocs.filter((d) => d.status === "failed").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document repository"
        description="Regulatory feed items are created by automation from external circulars. Uploaded documents are files your team adds for extraction."
      />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex rounded-lg border border-[#424655]/40 p-1 bg-[#051424]/40 w-fit">
          <button
            type="button"
            onClick={() => setDocTab("regulatory")}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              docTab === "regulatory" ? "bg-[#b0c6ff]/20 text-[#d4e4fa]" : "text-[#8c90a1] hover:text-[#d4e4fa]"
            )}
          >
            Regulatory feed
          </button>
          <button
            type="button"
            onClick={() => setDocTab("uploaded")}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              docTab === "uploaded" ? "bg-[#b0c6ff]/20 text-[#d4e4fa]" : "text-[#8c90a1] hover:text-[#d4e4fa]"
            )}
          >
            Uploaded documents
          </button>
        </div>
        {docTab === "uploaded" && (
          <Link
            href="/upload"
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 transition-colors text-sm font-medium w-fit"
          >
            <Upload className="w-4 h-4" />
            Upload document
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: docTab === "regulatory" ? "Feed items" : "Total documents", value: totalDocs, icon: Database, color: "text-[#b0c6ff]", bg: "bg-[#b0c6ff]/10 border-[#b0c6ff]/20" },
          { label: "Processed", value: processedDocs, icon: CheckCircle2, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
          { label: "Obligations found", value: totalObligations, icon: Hash, color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20" },
          { label: "Failed", value: failedDocs, icon: AlertCircle, color: "text-red-400", bg: "bg-red-500/10 border-red-500/20" },
        ].map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div key={stat.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
              className="glass-panel rounded-xl p-4 flex items-center gap-3">
              <div className={cn("w-10 h-10 rounded-lg border flex items-center justify-center shrink-0", stat.bg)}>
                <Icon className={cn("w-5 h-5", stat.color)} />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#d4e4fa]">{stat.value}</p>
                <p className="text-xs text-[#8c90a1]">{stat.label}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Document List */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#d4e4fa]">
              {docTab === "regulatory" ? "Regulatory feed" : "Uploaded documents"}
            </h2>
            <button onClick={fetchDocuments} className="flex items-center gap-1.5 text-xs text-[#8c90a1] hover:text-[#d4e4fa] transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </button>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="glass-panel rounded-xl p-4 animate-pulse">
                  <div className="flex gap-3">
                    <div className="w-10 h-10 rounded-lg bg-[#273647]" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-[#273647] rounded w-3/4" />
                      <div className="h-3 bg-[#273647] rounded w-1/2" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredDocs.length === 0 ? (
            <GlassCard className="p-12 text-center">
              <FileText className="w-12 h-12 text-[#8c90a1] mx-auto mb-3 opacity-50" />
              <p className="text-[#8c90a1] text-sm mb-3">
                {docTab === "regulatory"
                  ? "No regulatory feed documents yet. Run compliance automation on the dashboard or Agents page."
                  : "No uploaded documents yet."}
              </p>
              {docTab === "uploaded" && (
                <Link href="/upload" className="text-[#b0c6ff] text-sm hover:underline">
                  Upload your first document →
                </Link>
              )}
            </GlassCard>
          ) : (
            <AnimatePresence>
              {filteredDocs.map((doc, i) => {
                const status = statusConfig[doc.status] ?? statusConfig.queued;
                const StatusIcon = status.icon;
                const isProcessing = doc.status === "processing";

                return (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={() => setSelectedDoc(doc)}
                    className={cn(
                      "glass-panel rounded-xl p-4 cursor-pointer transition-all border",
                      selectedDoc?.id === doc.id
                        ? "border-[#b0c6ff]/40 bg-[#b0c6ff]/[0.04]"
                        : "border-transparent hover:border-[#b0c6ff]/20"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-[#273647]/60 border border-[#424655]/30 flex items-center justify-center shrink-0">
                        <FileTypeIcon mimeType={doc.mime_type} className="w-5 h-5 text-[#b0c6ff]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium text-[#d4e4fa] truncate">{doc.name}</p>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border", status.className)}>
                              <StatusIcon className={cn("w-3 h-3", isProcessing && "animate-spin")} />
                              {status.label}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-[#8c90a1]">
                          <span>{formatBytes(doc.size)}</span>
                          <span>•</span>
                          <span>{doc.obligations_extracted ?? 0} obligations</span>
                          <span>•</span>
                          <span>{formatDate(doc.uploaded_at)}</span>
                        </div>
                        {doc.status === "processed" && doc.confidence_score > 0 && (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="flex-1 h-1 bg-[#273647] rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#568dff] to-[#b0c6ff]"
                                style={{ width: `${doc.confidence_score}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-[#8c90a1]">{doc.confidence_score.toFixed(0)}% confidence</span>
                          </div>
                        )}
                        {doc.status === "failed" && Boolean(doc.metadata?.failure_reason) && (
                          <p className="text-[11px] text-red-400 mt-1 truncate">
                            Error: {String(doc.metadata.failure_reason).slice(0, 80)}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-3 pt-3 border-t border-white/[0.04]">
                      <button
                        onClick={(e) => { e.stopPropagation(); setSelectedDoc(doc); }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-[#8c90a1] hover:text-[#d4e4fa] hover:bg-[#273647]/50 transition-colors"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View Details
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(doc.id, doc.name); }}
                        disabled={deletingId === doc.id}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                      >
                        {deletingId === doc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        Delete
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          )}
        </div>

        {/* Detail Panel */}
        <div className="lg:col-span-1">
          <AnimatePresence mode="wait">
            {selectedDoc ? (
              <motion.div
                key={selectedDoc.id}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 16 }}
              >
                <GlassCard className="p-5 sticky top-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <h3 className="text-sm font-semibold text-[#d4e4fa]">Document Details</h3>
                    <button onClick={() => setSelectedDoc(null)} className="text-[#8c90a1] hover:text-[#d4e4fa] transition-colors text-lg leading-none">&times;</button>
                  </div>

                  <div className="w-full aspect-video rounded-lg bg-[#0d1c2d] border border-[#424655]/30 flex items-center justify-center">
                    <div className="text-center">
                      <FileTypeIcon mimeType={selectedDoc.mime_type} className="w-12 h-12 text-[#b0c6ff]/50 mx-auto mb-2" />
                      <p className="text-xs text-[#8c90a1]">
                        {selectedDoc.mime_type === "application/pdf" ? "PDF Document" : selectedDoc.mime_type}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3 text-xs">
                    <h4 className="font-semibold text-[#d4e4fa] break-words">{selectedDoc.name}</h4>

                    {[
                      { label: "Status", value: statusConfig[selectedDoc.status]?.label ?? selectedDoc.status },
                      { label: "File Size", value: formatBytes(selectedDoc.size) },
                      { label: "Uploaded By", value: selectedDoc.uploaded_by },
                      { label: "Obligations Found", value: String(selectedDoc.obligations_extracted ?? 0) },
                      { label: "Confidence", value: `${selectedDoc.confidence_score?.toFixed(0) ?? 0}%` },
                    ].map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between gap-2">
                        <span className="text-[#8c90a1] shrink-0">{label}</span>
                        <span className="text-[#d4e4fa] text-right">{value}</span>
                      </div>
                    ))}

                    <div className="border-t border-white/[0.06] pt-3">
                      <p className="text-[#8c90a1] mb-1 flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        Uploaded
                      </p>
                      <p className="text-[#d4e4fa]">{formatDate(selectedDoc.uploaded_at)}</p>
                    </div>

                    {selectedDoc.processed_at && (
                      <div>
                        <p className="text-[#8c90a1] mb-1 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          Processed
                        </p>
                        <p className="text-[#d4e4fa]">{formatDate(selectedDoc.processed_at)}</p>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-white/[0.06] space-y-2">
                    <button
                      onClick={async () => {
                        try {
                          const res = await api(`/api/documents/${selectedDoc.id}/download`);
                          if (!res.ok) { toast.error("Could not generate download link"); return; }
                          const { signed_url, filename } = await res.json();
                          const a = document.createElement("a");
                          a.href = signed_url; a.download = filename; a.target = "_blank"; a.rel = "noopener noreferrer"; a.click();
                        } catch { toast.error("Download failed"); }
                      }}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-emerald-500/20 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download Original
                    </button>
                    <Link
                      href="/obligations"
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[#b0c6ff]/10 border border-[#b0c6ff]/20 text-[#b0c6ff] text-xs font-medium hover:bg-[#b0c6ff]/20 transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      View Obligations
                    </Link>
                    <button
                      onClick={() => handleDelete(selectedDoc.id, selectedDoc.name)}
                      disabled={deletingId === selectedDoc.id}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    >
                      {deletingId === selectedDoc.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Delete Document
                    </button>
                  </div>
                </GlassCard>
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 0.7 }} exit={{ opacity: 0 }}>
                <GlassCard className="p-6 text-center">
                  <Eye className="w-8 h-8 text-[#8c90a1] mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-[#8c90a1]">Click a document to see details</p>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
