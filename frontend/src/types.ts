// Shared types for the Cyber-Thai Command Center dashboard.
// Mirrors nexus_agent/core/dashboard_hub.py::DashboardEvent.

export type MicroState =
  | "idle"
  | "thinking"
  | "planning"
  | "coding"
  | "designing"
  | "testing"
  | "executing"
  | "optimizing"
  | "waiting_for_human"
  | "error"
  | "completed"
  | "walking";

export type AgentRole =
  | "technical_architect"
  | "developer"
  | "autonomous_optimizer"
  | "planner"
  | "executor"
  | "validator"
  | "ui_weaver"
  | "learner";

export interface AgentMetrics {
  processing_time_ms: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  cpu_percent: number;
  memory_mb: number;
}

export interface AgentRuntimeState {
  agent_id: string;
  role: AgentRole;
  display_name: string;
  current_micro_state: MicroState;
  status_message: string;
  last_updated: number;
  metrics: AgentMetrics;
  current_task_id?: string | null;
  exp_points: number;
}

export interface DashboardEvent {
  event: "agent_update" | "exp_gained" | "log" | "snapshot";
  agent_id: string;
  role: AgentRole;
  micro_state: MicroState;
  status_message: string;
  metrics: AgentMetrics;
  extra?: Record<string, unknown>;
  timestamp: number;
}

export interface DashboardSnapshot {
  type: "snapshot";
  agents: AgentRuntimeState[];
  timestamp: number;
}
