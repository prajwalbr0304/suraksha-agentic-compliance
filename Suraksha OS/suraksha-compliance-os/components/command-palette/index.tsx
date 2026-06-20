"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Search, LayoutDashboard, Upload, FolderOpen, Scale, GitBranch,
  ScrollText, BarChart3, FileBarChart, Settings, Network, GitCompare,
  ShieldCheck, Zap, FileText, X, ClipboardList,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrincipal } from "@/hooks/use-principal";
import { withTenantWorkspaceHref } from "@/lib/auth/tenant-routes";

const COMMANDS = [
  { id: "dashboard",       label: "Executive Dashboard",         href: "/dashboard",         icon: LayoutDashboard, group: "Pages" },
  { id: "upload",          label: "Upload Document",             href: "/upload",             icon: Upload,         group: "Pages", personas: ["platform_admin", "org_admin", "compliance_admin", "compliance_analyst"] },
  { id: "documents",       label: "Document Management",         href: "/documents",          icon: FolderOpen,     group: "Pages" },
  { id: "obligations",     label: "Obligations Repository",      href: "/obligations",        icon: Scale,          group: "Pages" },
  { id: "map-board",       label: "Compliance Action Board",     href: "/map-board",          icon: GitBranch,      group: "Pages" },
  { id: "my-tasks",        label: "My tasks (assigned MAPs)",    href: "/my-tasks",           icon: ClipboardList,  group: "Pages" },
  { id: "knowledge-graph", label: "Compliance Knowledge Graph",  href: "/knowledge-graph",    icon: Network,        group: "Pages" },
  { id: "drift",           label: "Regulatory Change Analysis",  href: "/drift",              icon: GitCompare,     group: "Pages" },
  { id: "readiness",       label: "Readiness Scoring Center",    href: "/readiness",          icon: ShieldCheck,    group: "Pages" },
  { id: "evidence",        label: "Evidence Intelligence",       href: "/evidence",           icon: FileText,       group: "Pages" },
  { id: "impact",          label: "Compliance Impact Analysis",  href: "/impact",             icon: Zap,            group: "Pages" },
  { id: "audit",           label: "Audit Trail",                 href: "/audit",              icon: ScrollText,     group: "Pages" },
  { id: "analytics",       label: "Risk & Analytics",            href: "/analytics",          icon: BarChart3,      group: "Pages" },
  { id: "reports",         label: "Compliance Reports",          href: "/reports",            icon: FileBarChart,   group: "Pages" },
  { id: "settings",        label: "Settings",                    href: "/settings",           icon: Settings,       group: "Pages", personas: ["platform_admin", "org_admin", "compliance_admin"] },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { principal } = usePrincipal();
  const role = principal?.role;

  const commands = useMemo(
    () =>
      COMMANDS.map((c) => ({
        ...c,
        href:
          !principal || principal.isFounder ? c.href : withTenantWorkspaceHref(c.href, principal),
      })),
    [principal]
  );

  const filtered = commands.filter(cmd =>
    (!cmd.personas || (role && cmd.personas.includes(role))) &&
    cmd.label.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    if (open) {
      setQuery(""); setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const navigate = useCallback((href: string) => {
    router.push(href);
    onClose();
  }, [router, onClose]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx(p => Math.min(p + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx(p => Math.max(p - 1, 0)); }
      if (e.key === "Enter" && filtered[selectedIdx]) navigate(filtered[selectedIdx].href);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, selectedIdx, navigate, onClose]);

  useEffect(() => { setSelectedIdx(0); }, [query]);

  // Group commands
  const groups: Record<string, typeof commands> = {};
  filtered.forEach(cmd => {
    if (!groups[cmd.group]) groups[cmd.group] = [];
    groups[cmd.group].push(cmd);
  });

  let flatIdx = 0;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] flex items-start justify-center pt-24 px-4"
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-xl bg-[#0a1929] border border-[#424655]/50 rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.06]">
              <Search className="w-4 h-4 text-[#8c90a1] flex-shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search pages, features..."
                className="flex-1 bg-transparent text-[#d4e4fa] text-sm placeholder:text-[#8c90a1]/60 focus:outline-none"
              />
              <button onClick={onClose} className="flex-shrink-0 p-1 rounded text-[#8c90a1] hover:text-[#d4e4fa] transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-80 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-[#8c90a1] text-sm">No results for &ldquo;{query}&rdquo;</div>
              ) : (
                Object.entries(groups).map(([group, cmds]) => (
                  <div key={group}>
                    <div className="px-4 pt-3 pb-1">
                      <span className="text-[10px] font-semibold text-[#8c90a1] uppercase tracking-wider">{group}</span>
                    </div>
                    {cmds.map((cmd) => {
                      const idx = flatIdx++;
                      const Icon = cmd.icon;
                      const isSelected = selectedIdx === idx;
                      return (
                        <button
                          key={cmd.id}
                          onMouseEnter={() => setSelectedIdx(idx)}
                          onClick={() => navigate(cmd.href)}
                          className={cn("w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors", isSelected ? "bg-[#b0c6ff]/10" : "hover:bg-white/[0.03]")}
                        >
                          <div className={cn("flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center", isSelected ? "bg-[#b0c6ff]/20" : "bg-[#273647]/40")}>
                            <Icon className={cn("w-3.5 h-3.5", isSelected ? "text-[#b0c6ff]" : "text-[#8c90a1]")} />
                          </div>
                          <span className={cn("text-sm", isSelected ? "text-[#d4e4fa]" : "text-[#8c90a1]")}>{cmd.label}</span>
                          {isSelected && (
                            <span className="ml-auto text-[10px] text-[#8c90a1] border border-[#424655]/50 rounded px-1.5 py-0.5">↵ Go</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Footer hint */}
            <div className="px-4 py-2.5 border-t border-white/[0.06] flex items-center gap-4">
              <span className="text-[10px] text-[#8c90a1]">↑↓ Navigate</span>
              <span className="text-[10px] text-[#8c90a1]">↵ Select</span>
              <span className="text-[10px] text-[#8c90a1]">Esc Close</span>
              <span className="ml-auto text-[10px] text-[#8c90a1]">⌘K to open</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Global keyboard shortcut hook for Cmd/Ctrl+K
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(p => !p);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return { open, setOpen };
}
