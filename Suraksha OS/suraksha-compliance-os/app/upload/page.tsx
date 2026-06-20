"use client";

import { useCallback, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { PageHeader, GlassCard, ConfidenceBadge } from "@/components/ui/glass-card";
import { useUpload } from "@/hooks/use-upload";
import {
  CloudUpload,
  FileText,
  FileImage,
  File,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Download,
  Trash2,
  RefreshCw,
  Shield,
  Zap,
  Clock,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UploadQueueItem } from "@/hooks/use-upload";

// ---------------------------------------------------------------------------
// File type icon helper
// ---------------------------------------------------------------------------

function FileTypeIcon({ mimeType, className }: { mimeType: string; className?: string }) {
  if (mimeType.startsWith("image/")) return <FileImage className={className} />;
  if (mimeType === "application/pdf") return <FileText className={className} />;
  return <File className={className} />;
}

function fileTypeLabel(mimeType: string): string {
  const m: Record<string, string> = {
    "application/pdf": "PDF",
    "application/msword": "DOC",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
    "image/tiff": "TIFF",
    "image/png": "PNG",
    "image/jpeg": "JPEG",
  };
  return m[mimeType] ?? "FILE";
}

// ---------------------------------------------------------------------------
// Queue Item Card
// ---------------------------------------------------------------------------

function QueueCard({ item, onRemove }: { item: UploadQueueItem; onRemove: (id: string) => void }) {
  const isActive = item.status === "uploading";
  const isDone = item.status === "processing" || item.status === "completed";
  const isFailed = item.status === "failed";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "relative rounded-xl p-4 border overflow-hidden",
        isActive && "bg-[#122131] border-[#b0c6ff]/30",
        isDone && "bg-[#122131]/70 border-emerald-500/20",
        isFailed && "bg-[#122131]/70 border-red-500/30"
      )}
    >
      {/* Active glow */}
      {isActive && (
        <div className="absolute inset-0 bg-gradient-to-r from-[#b0c6ff]/[0.04] via-transparent to-[#b0c6ff]/[0.04] pointer-events-none" />
      )}

      <div className="relative z-10">
        {/* Header row */}
        <div className="flex items-start gap-3 mb-2">
          <div
            className={cn(
              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
              isActive && "bg-[#b0c6ff]/10 text-[#b0c6ff]",
              isDone && "bg-emerald-500/10 text-emerald-400",
              isFailed && "bg-red-500/10 text-red-400"
            )}
          >
            {isActive && <Loader2 className="w-4 h-4 animate-spin" />}
            {isDone && <CheckCircle2 className="w-4 h-4" />}
            {isFailed && <AlertCircle className="w-4 h-4" />}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-[#d4e4fa] truncate">{item.name}</span>
              <button
                onClick={() => onRemove(item.id)}
                className="text-[#424655] hover:text-[#8c90a1] transition-colors shrink-0"
                aria-label="Remove"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[10px] font-semibold text-[#424655] uppercase tracking-wider bg-[#273647] px-1.5 py-0.5 rounded">
                {fileTypeLabel(item.type)}
              </span>
              <span className="text-xs text-[#8c90a1]">{item.size}</span>
              {isActive && item.progress > 0 && (
                <span className="text-xs font-semibold text-[#b0c6ff]">{item.progress}%</span>
              )}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        {isActive && (
          <>
            <div className="w-full h-1 bg-[#273647] rounded-full overflow-hidden mb-1">
              <motion.div
                className="h-full bg-[#b0c6ff] rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${item.progress}%` }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              />
            </div>
            {item.progressMessage && (
              <p className="text-[11px] text-[#8c90a1]">{item.progressMessage}</p>
            )}
          </>
        )}

        {/* Error message */}
        {isFailed && item.errorMessage && (
          <p className="text-xs text-red-400 mt-1">{item.errorMessage}</p>
        )}

        {/* Done state */}
        {isDone && (
          <p className="text-xs text-emerald-400">
            Queued for AI extraction &middot; Obligations will appear in 2&ndash;5 min
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const ACCEPTED_EXTENSIONS = ".pdf,.doc,.docx,.tiff,.png,.jpg,.jpeg";

export default function UploadPage() {
  const { queue, recent, isLoadingRecent, uploadFiles, removeFromQueue, clearCompleted } =
    useUpload();

  const [isDragging, setIsDragging] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      setDragError(null);
      uploadFiles(Array.from(fileList));
    },
    [uploadFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setDragError(null);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      handleFiles(e.target.files);
      // Reset so same file can be re-selected
      e.target.value = "";
    },
    [handleFiles]
  );

  const activeQueue = queue.filter((f) => f.status === "uploading");
  const doneQueue = queue.filter(
    (f) => f.status === "processing" || f.status === "completed" || f.status === "failed"
  );
  const hasQueue = queue.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Document Upload & Intake"
        description="Securely ingest regulatory texts, circulars, and internal governance files for AI extraction."
      />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* â”€â”€ Left: Drop Zone + Queue â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="xl:col-span-7 flex flex-col gap-5">
          {/* Drop zone */}
          <motion.div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            animate={{
              borderColor: isDragging
                ? "rgba(176, 198, 255, 0.7)"
                : dragError
                ? "rgba(248, 113, 113, 0.5)"
                : "rgba(66, 70, 85, 0.4)",
              scale: isDragging ? 1.01 : 1,
              backgroundColor: isDragging ? "rgba(18, 33, 49, 0.7)" : "rgba(5, 20, 36, 0.4)",
            }}
            transition={{ duration: 0.15 }}
            className="relative rounded-xl border-2 border-dashed backdrop-blur-2xl flex flex-col items-center justify-center p-10 min-h-[340px] cursor-pointer group select-none"
          >
            {/* Hidden file input */}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_EXTENSIONS}
              multiple
              className="hidden"
              onChange={handleInputChange}
            />

            {/* Status pill */}
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-[#122131]/80 backdrop-blur border border-[#424655]/30 rounded-full px-3 py-1">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] uppercase tracking-[0.05em] font-semibold text-[#b0c6ff]">
                AI Engine Active
              </span>
            </div>

            {/* Main content */}
            <div className="flex flex-col items-center text-center">
              <motion.div
                animate={{
                  scale: isDragging ? 1.2 : 1,
                  backgroundColor: isDragging ? "rgba(176, 198, 255, 0.12)" : "rgba(18, 33, 49, 1)",
                }}
                className="w-20 h-20 rounded-full border border-[#424655]/30 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform duration-300"
              >
                <AnimatePresence mode="wait">
                  {isDragging ? (
                    <motion.div
                      key="dropping"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                    >
                      <CloudUpload className="w-10 h-10 text-[#b0c6ff]" />
                    </motion.div>
                  ) : (
                    <motion.div
                      key="idle"
                      initial={{ scale: 0.8, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.8, opacity: 0 }}
                    >
                      <CloudUpload className="w-10 h-10 text-[#8c90a1] group-hover:text-[#b0c6ff] transition-colors" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              <h3 className="text-xl font-semibold text-[#d4e4fa] mb-2">
                {isDragging ? "Release to upload" : "Drag & drop documents here"}
              </h3>
              <p className="text-sm text-[#8c90a1] mb-2 max-w-sm">
                PDF, DOCX, DOC, PNG, JPEG, TIFF â€” up to 50 MB per file
              </p>
              <p className="text-xs text-[#424655] mb-6">
                Files are encrypted in transit and at rest Â· AES-256
              </p>

              <AnimatePresence>
                {dragError && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="flex items-center gap-2 text-red-400 text-sm mb-4 bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-2"
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {dragError}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center gap-3">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    inputRef.current?.click();
                  }}
                  className="bg-[#b0c6ff] text-[#002d6f] text-sm font-semibold px-6 py-2.5 rounded-lg hover:bg-[#568dff] hover:text-white transition-all glow-primary"
                >
                  Browse Files
                </button>
                <span className="text-[#424655] text-sm">or drag & drop</span>
              </div>
            </div>

            {/* Accepted formats */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {["PDF", "DOCX", "PNG", "TIFF"].map((fmt) => (
                <span
                  key={fmt}
                  className="text-[10px] font-semibold text-[#424655] uppercase tracking-wider bg-[#122131]/60 border border-[#424655]/20 px-2 py-0.5 rounded"
                >
                  {fmt}
                </span>
              ))}
              <span className="text-[10px] text-[#424655]">+ more</span>
            </div>
          </motion.div>

          {/* Active upload queue */}
          <AnimatePresence>
            {hasQueue && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
              >
                <GlassCard className="p-0 overflow-hidden">
                  <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-3.5 h-3.5 text-[#b0c6ff]" />
                      <h3 className="text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">
                        Upload Queue
                      </h3>
                    </div>
                    <div className="flex items-center gap-3">
                      {activeQueue.length > 0 && (
                        <span className="text-xs text-[#b0c6ff] font-medium flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          {activeQueue.length} uploading
                        </span>
                      )}
                      {doneQueue.length > 0 && (
                        <button
                          onClick={clearCompleted}
                          className="text-xs text-[#8c90a1] hover:text-[#d4e4fa] transition-colors"
                        >
                          Clear done
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="p-3 space-y-2">
                    <AnimatePresence>
                      {queue.map((item) => (
                        <QueueCard key={item.id} item={item} onRemove={removeFromQueue} />
                      ))}
                    </AnimatePresence>
                  </div>
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Capabilities strip */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: Shield, label: "AES-256 Encrypted", sub: "End-to-end security" },
              { icon: Zap, label: "AI Extraction", sub: "Obligations in minutes" },
              { icon: RefreshCw, label: "Auto-classify", sub: "RBI, SEBI, PMLA & more" },
            ].map(({ icon: Icon, label, sub }) => (
              <div
                key={label}
                className="glass-panel rounded-xl p-3.5 flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-lg bg-[#b0c6ff]/10 border border-[#b0c6ff]/20 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-[#b0c6ff]" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-[#d4e4fa] leading-tight">{label}</p>
                  <p className="text-[10px] text-[#8c90a1]">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* â”€â”€ Right: Status Panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
        <div className="xl:col-span-5 flex flex-col gap-5">
          {/* Active processing items */}
          <GlassCard className="p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/[0.06] bg-[#122131]/30 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#b0c6ff] animate-pulse" />
                <h3 className="text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">
                  Active Ingestion
                </h3>
              </div>
              <span className="text-xs font-medium text-[#b0c6ff]">
                {activeQueue.length} items
              </span>
            </div>

            <div className="p-3 space-y-2 min-h-[80px]">
              {activeQueue.length === 0 ? (
                <div className="flex items-center justify-center h-16 text-[#424655] text-sm">
                  No active uploads
                </div>
              ) : (
                <AnimatePresence>
                  {activeQueue.map((item) => (
                    <motion.div
                      key={item.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="bg-[#122131] rounded-lg p-3.5 border border-[#b0c6ff]/20"
                      style={{ boxShadow: "0 0 12px rgba(176, 198, 255, 0.08)" }}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <Loader2 className="w-3.5 h-3.5 text-[#b0c6ff] animate-spin shrink-0" />
                        <span className="text-xs font-medium text-[#d4e4fa] truncate flex-1">
                          {item.name}
                        </span>
                        <span className="text-xs font-bold text-[#b0c6ff]">{item.progress}%</span>
                      </div>
                      <div className="w-full h-1 bg-[#273647] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-[#568dff] to-[#b0c6ff] rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${item.progress}%` }}
                          transition={{ duration: 0.4, ease: "easeOut" }}
                        />
                      </div>
                      {item.progressMessage && (
                        <p className="text-[10px] text-[#8c90a1] mt-1">{item.progressMessage}</p>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </GlassCard>

          {/* Recently Processed */}
          <GlassCard className="p-0 overflow-hidden flex-1">
            <div className="px-4 py-3 border-b border-white/[0.06] bg-[#122131]/30 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-3.5 h-3.5 text-[#8c90a1]" />
                <h3 className="text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">
                  Recently Processed
                </h3>
              </div>
              {isLoadingRecent && <Loader2 className="w-3.5 h-3.5 text-[#424655] animate-spin" />}
            </div>

            <div className="divide-y divide-white/[0.04] max-h-[420px] overflow-y-auto">
              <AnimatePresence>
                {recent
                  .filter((f) => f.status === "completed" || f.status === "processing")
                  .map((file, i) => (
                    <motion.div
                      key={file.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="px-4 py-3 flex items-center gap-3 hover:bg-[#273647]/20 transition-colors cursor-pointer group"
                    >
                      {/* File icon */}
                      <div className="w-9 h-9 rounded-lg bg-[#273647]/50 border border-[#424655]/30 flex items-center justify-center text-[#8c90a1] group-hover:text-[#b0c6ff] transition-colors shrink-0">
                        <FileTypeIcon mimeType={file.type} className="w-4 h-4" />
                      </div>

                      {/* Meta */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#d4e4fa] truncate">{file.name}</p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-[#8c90a1]">{file.timestamp}</span>
                          {file.obligationsFound != null && file.obligationsFound > 0 && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-[#424655]" />
                              <span className="text-xs text-emerald-400 font-medium">
                                {file.obligationsFound} obligations
                              </span>
                            </>
                          )}
                          {file.status === "processing" && (
                            <>
                              <span className="w-1 h-1 rounded-full bg-[#424655]" />
                              <span className="text-xs text-[#b0c6ff] flex items-center gap-1">
                                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                                Extractingâ€¦
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Confidence / action */}
                      <div className="flex items-center gap-2 shrink-0">
                        {file.confidence != null && file.confidence > 0 && (
                          <ConfidenceBadge confidence={file.confidence} />
                        )}
                        <ChevronRight className="w-4 h-4 text-[#424655] group-hover:text-[#8c90a1] transition-colors" />
                      </div>
                    </motion.div>
                  ))}
              </AnimatePresence>

              {recent.filter((f) => f.status === "completed" || f.status === "processing")
                .length === 0 &&
                !isLoadingRecent && (
                  <div className="px-4 py-8 text-center text-[#424655] text-sm">
                    No documents processed yet
                  </div>
                )}
            </div>

            <div className="p-3 border-t border-white/[0.06] text-center bg-[#122131]/20">
              <button className="text-[#b0c6ff] text-xs hover:underline">
                View Full Document Archive
              </button>
            </div>
          </GlassCard>

          {/* Storage stats */}
          <div className="glass-panel rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] uppercase tracking-[0.05em] font-semibold text-[#8c90a1]">
                Storage Used
              </p>
              <span className="text-xs text-[#b0c6ff] font-medium">
                {recent.length} documents
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-1.5 bg-[#273647] rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#568dff] to-[#b0c6ff] rounded-full"
                  style={{ width: `${Math.min((recent.length / 500) * 100, 100)}%` }}
                />
              </div>
              <span className="text-xs text-[#8c90a1] shrink-0">
                {recent.length} / 500
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
