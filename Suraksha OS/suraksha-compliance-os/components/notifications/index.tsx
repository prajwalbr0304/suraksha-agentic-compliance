"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, X, CheckCheck, AlertTriangle, CheckCircle, Info, Zap, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { authFetch } from "@/lib/auth/client";
import { supabase } from "@/lib/supabase/client";

interface Notification {
  id: string; title: string; message: string;
  type: "info" | "warning" | "error" | "success" | "escalation";
  read: boolean; created_at: string;
}

const TYPE_CONFIG = {
  info:       { icon: Info,          color: "text-blue-400",    bg: "bg-blue-500/10" },
  warning:    { icon: AlertTriangle, color: "text-amber-400",   bg: "bg-amber-500/10" },
  error:      { icon: AlertTriangle, color: "text-red-400",     bg: "bg-red-500/10" },
  success:    { icon: CheckCircle,   color: "text-emerald-400", bg: "bg-emerald-500/10" },
  escalation: { icon: Zap,           color: "text-purple-400",  bg: "bg-purple-500/10" },
};

interface NotificationCenterProps { open: boolean; onClose: () => void; }

export function NotificationCenter({ open, onClose }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotifications = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch("/api/notifications");
      const data = await res.json();
      setNotifications(Array.isArray(data) ? data : []);
    } catch { setNotifications([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) fetchNotifications(); }, [open, fetchNotifications]);

  const markAllRead = async () => {
    await authFetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) });
    setNotifications(p => p.map(n => ({ ...n, read: true })));
  };

  const markRead = async (id: string) => {
    await authFetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setNotifications(p => p.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <AnimatePresence>
      {open && (
        <>
          <div className="fixed inset-0 z-[150]" onClick={onClose} />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-80 bg-[#0a1929] border border-[#424655]/50 rounded-2xl shadow-2xl overflow-hidden z-[151]"
          >
            <div className="px-4 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-[#d4e4fa]" />
                <span className="text-sm font-semibold text-[#d4e4fa]">Notifications</span>
                {unreadCount > 0 && <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[#b0c6ff] text-[#002d6f] rounded-full">{unreadCount}</span>}
              </div>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-[10px] text-[#b0c6ff] hover:underline flex items-center gap-1">
                    <CheckCheck className="w-3 h-3" /> Mark all read
                  </button>
                )}
                <button onClick={onClose} className="p-1 rounded text-[#8c90a1] hover:text-[#d4e4fa]"><X className="w-3.5 h-3.5" /></button>
              </div>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="p-6 text-center text-[#8c90a1] text-sm">Loading...</div>
              ) : notifications.length === 0 ? (
                <div className="p-8 flex flex-col items-center gap-3 text-[#8c90a1]">
                  <Bell className="w-8 h-8 opacity-30" /><p className="text-sm">All caught up!</p>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {notifications.map(notif => {
                    const cfg = TYPE_CONFIG[notif.type] ?? TYPE_CONFIG.info;
                    const Icon = cfg.icon;
                    return (
                      <div key={notif.id} onClick={() => markRead(notif.id)}
                        className={cn("px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors", !notif.read && "bg-[#b0c6ff]/[0.03]")}>
                        <div className="flex items-start gap-2.5">
                          <div className={cn("flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center mt-0.5", cfg.bg)}>
                            <Icon className={cn("w-3.5 h-3.5", cfg.color)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className={cn("text-xs font-semibold leading-snug", notif.read ? "text-[#8c90a1]" : "text-[#d4e4fa]")}>{notif.title}</p>
                              {!notif.read && <div className="w-1.5 h-1.5 rounded-full bg-[#b0c6ff] flex-shrink-0 mt-1" />}
                            </div>
                            {notif.message && <p className="text-[11px] text-[#8c90a1] mt-0.5 leading-relaxed line-clamp-2">{notif.message}</p>}
                            <div className="flex items-center gap-1 mt-1.5 text-[10px] text-[#8c90a1]/60">
                              <Clock className="w-2.5 h-2.5" />
                              {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export function useNotificationCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    const fetchCount = async () => {
      try {
        const res = await authFetch("/api/notifications");
        const data = await res.json();
        if (mounted) setCount(Array.isArray(data) ? data.filter((n: Notification) => !n.read).length : 0);
      } catch { /* silent */ }
    };

    fetchCount();

    // Supabase realtime subscription — replaces 60s polling
    const channel = supabase
      .channel("notifications-count")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications" }, () => {
        fetchCount();
      })
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, []);

  return count;
}
