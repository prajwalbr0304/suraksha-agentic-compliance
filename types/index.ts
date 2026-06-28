// Navigation Types
export interface NavItem {
  title: string;
  href: string;
  icon: string;
  badge?: string;
  personas?: string[];
}

// Dashboard Types
export interface KPIMetric {
  title: string;
  value: string;
  change: string;
  changeType: "positive" | "negative" | "neutral";
  icon: string;
}

/** Large headline metrics for the compliance command center */
export interface HeroMetric {
  title: string;
  value: string;
  subtitle: string;
  /** Visual accent for the card border / emphasis */
  accent: "neutral" | "info" | "warning" | "danger" | "success";
}

/** Narrative AI + automation lines for the dashboard feed */
export interface AiActivityItem {
  id: string;
  line: string;
  timestamp: string;
  tone: "success" | "warning" | "info" | "error";
  /** ISO time for sorting / timeline clock */
  sortKey?: string;
  /** e.g. 2:41:08 PM */
  timeLabel?: string;
  /** Extra context (URLs, JSON hints) shown in full-log mode */
  detail?: string;
}

/** Latest coordinator `agent_runs` row for live pipeline UI */
export interface LiveCoordinatorRunState {
  runId: string;
  status: "running" | "completed" | "failed";
  pipeline: string | null;
  stageIndex: number | null;
  stageKey: string | null;
  stageLabel: string | null;
  errorMessage: string | null;
  summary: string | null;
  startedAt: string;
  finishedAt: string | null;
}

/** Activity timeline density (compact summary vs. full technical log) */
export type ActivityLogMode = "compact" | "full";

/** Live automation queue snapshot (compliance command center) */
export interface AgentQueueMetrics {
  /** Regulatory rows awaiting document + PDF files in queued/processing */
  pendingPDFs: number;
  /** PDF documents in `documents` queued/processing (subset of pipeline) */
  pdfDocumentQueue: number;
  /** Active `agent_runs` with status running */
  processing: number;
  /** Last coordinator full run: regulatory changes deferred due to cap */
  deferred: number;
  /** `regulatory_changes` in duplicate status (PDF checksum dedupe) */
  duplicatesSkipped: number;
}

export interface ComplianceScore {
  category: string;
  score: number;
  maxScore: number;
  status: "healthy" | "warning" | "critical";
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  type: "upload" | "approval" | "extraction" | "escalation" | "review";
}

// Upload Types
export interface UploadFile {
  id: string;
  name: string;
  size: string;
  type: string;
  status: "uploading" | "processing" | "completed" | "failed";
  progress: number;
  obligationsFound?: number;
  confidence?: number;
  timestamp: string;
}

// Obligations Types
export interface Obligation {
  /** Row id in `obligations` (UUID) — use for APIs and evidence links */
  id: string;
  /** Human-readable reference when present */
  reference?: string;
  title: string;
  /** Full obligation / extracted text from DB */
  description: string;
  source: string;
  regulator: string;
  department: string;
  status: "active" | "pending" | "overdue" | "completed";
  confidence: number;
  dueDate: string;
  priority: "high" | "medium" | "low";
  citations: string[];
  /** Regulatory or source excerpt supporting detection */
  sourceQuote: string | null;
  /** Model / pipeline narrative */
  aiExplanation: string | null;
  /** Structured routing or keyword rationale when populated */
  extractionReason: string | null;
}

// MAP Board Types
export interface MAPCard {
  id: string;
  title: string;
  /** obligations.id (UUID) */
  obligation: string;
  /** Linked obligation title when joined */
  obligationTitle?: string | null;
  /** Owning department on the card or from the linked obligation */
  ownerDepartment?: string | null;
  /** Shown under assignment explainability */
  assignmentRationale?: string | null;
  owner: string;
  dueDate: string;
  status:
    | "ai-generated"
    | "pending-approval"
    | "approved"
    | "assigned"
    | "in-progress"
    | "under-review"
    | "completed"
    | "rejected"
    | "escalated"
    | "archived";
  priority: "critical" | "high" | "medium" | "low";
  evidence: EvidenceItem[];
  comments: number;
  escalated: boolean;
  generatedBy?: string;
  /** auth.users id when assigned */
  assignedTo?: string | null;
  teamId?: string | null;
}

export interface EvidenceItem {
  id: string;
  title: string;
  completed: boolean;
}

export type MAPColumn = {
  id: string;
  title: string;
  cards: MAPCard[];
};

// Audit Types
export interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: string;
  type: "approval" | "upload" | "extraction" | "escalation" | "modification" | "review";
  metadata?: Record<string, string>;
}

// Risk Analytics Types
export interface RiskScore {
  department: string;
  score: number;
  trend: "up" | "down" | "stable";
  overdueCount: number;
  /** Operational risk band (inverse of health score): high = unhealthy department */
  riskBand: "low" | "medium" | "high";
}

export interface ComplianceTrend {
  month: string;
  score: number;
  obligations: number;
  resolved: number;
}

// Settings Types
export interface SettingsSection {
  id: string;
  title: string;
  description: string;
}
