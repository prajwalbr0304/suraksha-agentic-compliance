"use client";

import { useState, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { PageHeader, GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { Building2, Bell, Shield, Brain, Palette, Save, ChevronRight, Loader2, RefreshCw, Lock } from "lucide-react";
import { useTenantApi } from "@/contexts/tenant-api-context";
import { usePrincipal } from "@/hooks/use-principal";

const STORAGE_KEY = "suraksha_settings";

interface SettingsState {
  org_name: string; org_license: string; org_regulator: string; org_officer: string;
  notif_overdue: boolean; notif_extraction: boolean; notif_escalation: boolean;
  notif_digest: boolean; notif_circular: boolean;
  threshold_critical: string; threshold_warning: string; threshold_escalate: string; threshold_review: string;
  ai_min_confidence: string; ai_extraction_depth: string;
  appearance_theme: string; appearance_accent: string;
}

const DEFAULTS: SettingsState = {
  org_name: "", org_license: "",
  org_regulator: "", org_officer: "",
  notif_overdue: true, notif_extraction: true, notif_escalation: true, notif_digest: false, notif_circular: true,
  threshold_critical: "60", threshold_warning: "75", threshold_escalate: "3", threshold_review: "7",
  ai_min_confidence: "70", ai_extraction_depth: "Standard",
  appearance_theme: "Dark Navy", appearance_accent: "#b0c6ff",
};

const settingsSections = [
  { id: "organization", title: "Organization", description: "Company details and preferences", icon: Building2 },
  { id: "notifications", title: "Notifications", description: "Alert and notification preferences", icon: Bell },
  { id: "compliance", title: "Compliance Thresholds", description: "Set compliance scoring thresholds", icon: Shield },
  { id: "extraction", title: "AI Extraction", description: "Configure extraction sensitivity", icon: Brain },
  { id: "appearance", title: "Appearance", description: "Theme and display settings", icon: Palette },
];

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!checked)} className={`w-11 h-6 rounded-full transition-colors relative ${checked ? "bg-[#b0c6ff]" : "bg-[#273647]"}`}>
      <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

export default function SettingsPage() {
  const api = useTenantApi();
  const [activeSection, setActiveSection] = useState("organization");
  const [isSaving, setIsSaving] = useState(false);
  const [settings, setSettings] = useState<SettingsState>(DEFAULTS);
  const { principal } = usePrincipal();
  const canManage = !!principal?.permissions?.some((p) => p === "settings.manage" || p === "admin.all");

  useEffect(() => {
    // Load from localStorage first (fast), then sync from DB
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSettings(prev => ({ ...prev, ...JSON.parse(raw) }));
    } catch {}

    api("/api/settings")
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.settings && typeof data.settings === "object") {
          const merged = { ...DEFAULTS, ...data.settings };
          setSettings(prev => ({ ...prev, ...merged }));
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        }
        if (data?.name) setSettings(prev => ({ ...prev, org_name: data.name }));
      })
      .catch(() => {}); // fall through to localStorage
  }, []);

  const set = (key: keyof SettingsState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings(prev => ({ ...prev, [key]: e.target.value }));
  const setVal = (key: keyof SettingsState, val: string | boolean) =>
    setSettings(prev => ({ ...prev, [key]: val }));

  const handleSave = useCallback(async () => {
    if (!canManage) {
      toast.error("Only an Organization Admin can change organization settings.");
      return;
    }
    setIsSaving(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      const res = await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          name: settings.org_name,
          settings: {
            org_regulator: settings.org_regulator,
            org_officer: settings.org_officer,
            notif_overdue: settings.notif_overdue,
            notif_extraction: settings.notif_extraction,
            notif_escalation: settings.notif_escalation,
            notif_digest: settings.notif_digest,
            notif_circular: settings.notif_circular,
            threshold_critical: settings.threshold_critical,
            threshold_warning: settings.threshold_warning,
            threshold_escalate: settings.threshold_escalate,
            threshold_review: settings.threshold_review,
            ai_min_confidence: settings.ai_min_confidence,
            ai_extraction_depth: settings.ai_extraction_depth,
            appearance_theme: settings.appearance_theme,
            appearance_accent: settings.appearance_accent,
          },
        }),
      });
      if (res.status === 403) {
        toast.error("You do not have permission to change organization settings.");
      } else if (!res.ok) {
        toast.error("Could not save to server — settings saved locally only.");
      } else {
        toast.success("Settings saved successfully");
      }
    } catch {
      toast.error("Failed to save settings");
    }
    setIsSaving(false);
  }, [settings]);

  const handleReset = () => {
    setSettings(DEFAULTS);
    localStorage.removeItem(STORAGE_KEY);
    toast.success("Settings reset to defaults");
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Configure your compliance platform preferences and thresholds." />

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <GlassCard className="p-2">
            <nav className="space-y-1">
              {settingsSections.map(section => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button key={section.id} onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150 ${isActive ? "bg-[#b0c6ff]/10 text-[#b0c6ff]" : "text-[#8c90a1] hover:text-[#d4e4fa] hover:bg-[#273647]/30"}`}>
                    <Icon className="w-4 h-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${isActive ? "font-semibold" : "font-medium"}`}>{section.title}</p>
                      <p className="text-[11px] text-[#8c90a1] truncate">{section.description}</p>
                    </div>
                    {isActive && <ChevronRight className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}
            </nav>
          </GlassCard>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <GlassCard className="p-6">
            {activeSection === "organization" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-[#d4e4fa] mb-1">Organization Settings</h3>
                  <p className="text-sm text-[#8c90a1]">Manage your organization&apos;s details and compliance configuration.</p>
                </div>
                <Separator className="bg-white/[0.06]" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Organization Name</label>
                    <Input value={settings.org_name} onChange={set("org_name")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">License ID</label>
                    <Input value={settings.org_license} readOnly className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa] opacity-60" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Primary Regulator</label>
                    <Input value={settings.org_regulator} onChange={set("org_regulator")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Compliance Officer</label>
                    <Input value={settings.org_officer} onChange={set("org_officer")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === "notifications" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-[#d4e4fa] mb-1">Notification Preferences</h3>
                  <p className="text-sm text-[#8c90a1]">Configure when and how you receive alerts.</p>
                </div>
                <Separator className="bg-white/[0.06]" />
                <div className="space-y-4">
                  {([
                    { key: "notif_overdue", label: "Overdue obligations", desc: "Alert when an obligation exceeds its due date" },
                    { key: "notif_extraction", label: "AI extraction complete", desc: "Notify when document processing finishes" },
                    { key: "notif_escalation", label: "Escalation triggers", desc: "Immediate alert on auto-escalation events" },
                    { key: "notif_digest", label: "Weekly compliance digest", desc: "Summary email every Monday" },
                    { key: "notif_circular", label: "New regulatory circulars", desc: "Alert when new regulations are detected" },
                  ] as { key: keyof SettingsState; label: string; desc: string }[]).map(item => (
                    <div key={item.key} className="flex items-center justify-between py-3 border-b border-white/[0.04] last:border-0">
                      <div>
                        <p className="text-sm font-medium text-[#d4e4fa]">{item.label}</p>
                        <p className="text-xs text-[#8c90a1] mt-0.5">{item.desc}</p>
                      </div>
                      <Toggle checked={settings[item.key] as boolean} onChange={v => setVal(item.key, v)} />
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {activeSection === "compliance" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-[#d4e4fa] mb-1">Compliance Thresholds</h3>
                  <p className="text-sm text-[#8c90a1]">Define scoring boundaries for risk classification.</p>
                </div>
                <Separator className="bg-white/[0.06]" />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Critical Threshold (%)</label>
                    <Input type="number" value={settings.threshold_critical} onChange={set("threshold_critical")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Warning Threshold (%)</label>
                    <Input type="number" value={settings.threshold_warning} onChange={set("threshold_warning")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Auto-escalation (days overdue)</label>
                    <Input type="number" value={settings.threshold_escalate} onChange={set("threshold_escalate")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Review Period (days)</label>
                    <Input type="number" value={settings.threshold_review} onChange={set("threshold_review")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === "extraction" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-[#d4e4fa] mb-1">AI Extraction Settings</h3>
                  <p className="text-sm text-[#8c90a1]">Configure AI model sensitivity and extraction parameters.</p>
                </div>
                <Separator className="bg-white/[0.06]" />
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Minimum Confidence (%)</label>
                    <Input type="number" value={settings.ai_min_confidence} onChange={set("ai_min_confidence")} className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa]" />
                    <p className="text-xs text-[#8c90a1] mt-1">Obligations below this threshold require manual review</p>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">AI Model</label>
                    <Input value="qwen2.5:1.5b (Ollama Local)" className="bg-[#0d1c2d] border-[#424655]/30 text-[#d4e4fa] opacity-60" readOnly />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-1.5 block">Extraction Depth</label>
                    <div className="flex gap-2">
                      {["Shallow", "Standard", "Deep"].map(level => (
                        <button key={level} onClick={() => setVal("ai_extraction_depth", level)}
                          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${settings.ai_extraction_depth === level ? "bg-[#b0c6ff]/10 text-[#b0c6ff] border-[#b0c6ff]/30" : "text-[#8c90a1] border-[#424655]/30 hover:border-[#424655]"}`}>
                          {level}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeSection === "appearance" && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-[#d4e4fa] mb-1">Appearance</h3>
                  <p className="text-sm text-[#8c90a1]">Customize the look and feel of your dashboard.</p>
                </div>
                <Separator className="bg-white/[0.06]" />
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-2 block">Theme</label>
                    <div className="flex gap-3">
                      {[
                        { name: "Dark Navy", color: "bg-[#051424]" },
                        { name: "Midnight", color: "bg-[#0a0a0a]" },
                        { name: "Deep Blue", color: "bg-[#0c1929]" },
                      ].map(theme => (
                        <button key={theme.name} onClick={() => setVal("appearance_theme", theme.name)}
                          className={`flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${settings.appearance_theme === theme.name ? "border-[#b0c6ff]/50 bg-[#b0c6ff]/5" : "border-[#424655]/30 hover:border-[#424655]"}`}>
                          <div className={`w-16 h-10 rounded-lg ${theme.color} border border-[#424655]/30`} />
                          <span className="text-xs text-[#d4e4fa]">{theme.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-[#8c90a1] uppercase tracking-wider mb-2 block">Accent Color</label>
                    <div className="flex gap-2">
                      {["#b0c6ff", "#4ade80", "#a78bfa", "#f472b6", "#fbbf24"].map(color => (
                        <button key={color} onClick={() => setVal("appearance_accent", color)}
                          className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${settings.appearance_accent === color ? "border-white scale-110" : "border-transparent"}`}
                          style={{ backgroundColor: color }} />
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Actions */}
            <div className="mt-8 pt-4 border-t border-white/[0.06] flex items-center justify-between gap-4">
              <button onClick={handleReset} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-[#8c90a1] hover:text-[#d4e4fa] hover:bg-[#273647]/30 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" /> Reset to defaults
              </button>
              <div className="flex items-center gap-3">
                {!canManage && (
                  <span className="flex items-center gap-1.5 text-[11px] text-[#8c90a1]">
                    <Lock className="w-3 h-3" /> Only Organization Admin can change settings
                  </span>
                )}
                <button onClick={handleSave} disabled={isSaving || !canManage}
                  title={canManage ? "Save changes" : "Requires Organization Admin"}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#b0c6ff] text-[#002d6f] hover:bg-[#b0c6ff]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium">
                  {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {isSaving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
