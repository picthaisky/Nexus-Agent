/**
 * useTaskSocket — connects to /ws/tasks/{taskId} and surfaces
 * fine-grained real-time events for a single task execution.
 *
 * Returned state
 * ──────────────
 * steps       List of plan steps with live status (pending → running → done/error)
 * output      Ordered array of execution output lines (stdout + stderr)
 * fileEvents  Files created/modified/deleted during the task
 * status      Overall task status
 * connected   WebSocket readiness
 * error       Last error message if status === "failed"
 */

import { useEffect, useRef, useState, useCallback } from "react";

// ── Event shapes (mirroring task_event_hub.py) ─────────────────────────────

export interface TaskStepState {
  step:        string;
  stepIndex:   number;
  totalSteps:  number;
  description: string;
  status:      "pending" | "running" | "done" | "error";
  output:      string;
  startedAt:   number | null;
  completedAt: number | null;
}

export interface OutputLine {
  id:        number;
  line:      string;
  stream:    "stdout" | "stderr";
  command:   string;
  timestamp: number;
}

export interface FileEventItem {
  id:             number;
  fileEventType:  "created" | "modified" | "deleted";
  path:           string;
  preview:        string;
  timestamp:      number;
}

export type TaskStatus = "idle" | "running" | "completed" | "failed";

export interface UseTaskSocketResult {
  steps:      TaskStepState[];
  output:     OutputLine[];
  fileEvents: FileEventItem[];
  thoughts:   { agent: string; thought: string; timestamp: number }[];
  status:     TaskStatus;
  connected:  boolean;
  error:      string | null;
  progress:   number;   // 0-100
  reset:      () => void;
}

function getWsBase(): string {
  try {
    const apiUrl = (import.meta as any).env?.VITE_NEXUS_API_URL as string | undefined;
    if (apiUrl) {
      const u = new URL(apiUrl);
      return `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`;
    }
  } catch { /* ignore */ }
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
}

let _lineId  = 0;
let _fileId  = 0;
const nextLineId = () => ++_lineId;
const nextFileId = () => ++_fileId;

export function useTaskSocket(taskId: string | null): UseTaskSocketResult {
  const [steps,      setSteps]      = useState<TaskStepState[]>([]);
  const [output,     setOutput]     = useState<OutputLine[]>([]);
  const [fileEvents, setFileEvents] = useState<FileEventItem[]>([]);
  const [thoughts,   setThoughts]   = useState<{ agent: string; thought: string; timestamp: number }[]>([]);
  const [status,     setStatus]     = useState<TaskStatus>("idle");
  const [connected,  setConnected]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const wsRef   = useRef<WebSocket | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const reset = useCallback(() => {
    setSteps([]); setOutput([]); setFileEvents([]); setThoughts([]);
    setStatus("idle"); setError(null); setConnected(false);
  }, []);

  useEffect(() => {
    if (!taskId) { reset(); return; }

    let retries = 0;

    function connect() {
      const url = `${getWsBase()}/ws/tasks/${taskId}`;
      const ws  = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => { setConnected(true); retries = 0; };

      ws.onclose = () => {
        setConnected(false);
        // Retry unless the task already finished
        setStatus(prev => {
          if (prev === "completed" || prev === "failed") return prev;
          retries += 1;
          const backoff = Math.min(500 * 2 ** retries, 8000);
          timerRef.current = window.setTimeout(connect, backoff);
          return prev;
        });
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data);
          const { event, payload, timestamp } = data;

          switch (event) {
            case "task_start":
              setStatus("running");
              setError(null);
              break;

            case "task_step_start":
              setSteps(prev => {
                // Upsert: create new or mark existing as running
                const exists = prev.find(s => s.step === payload.step);
                const updated: TaskStepState = {
                  step:        payload.step,
                  stepIndex:   payload.step_index,
                  totalSteps:  payload.total_steps,
                  description: payload.description || payload.step,
                  status:      "running",
                  output:      "",
                  startedAt:   timestamp,
                  completedAt: null,
                };
                if (exists) {
                  return prev.map(s => s.step === payload.step ? updated : s);
                }
                // Insert in order
                const next = [...prev, updated];
                next.sort((a, b) => a.stepIndex - b.stepIndex);
                return next;
              });
              break;

            case "task_step_complete":
              setSteps(prev => prev.map(s =>
                s.step === payload.step
                  ? { ...s, status: "done", output: payload.output || s.output, completedAt: timestamp }
                  : s,
              ));
              break;

            case "execution_output":
              setOutput(prev => {
                const line: OutputLine = {
                  id:        nextLineId(),
                  line:      payload.line,
                  stream:    payload.stream || "stdout",
                  command:   payload.command || "",
                  timestamp,
                };
                // Keep last 1000 lines
                return [...prev, line].slice(-1000);
              });
              break;

            case "file_event":
              setFileEvents(prev => {
                const item: FileEventItem = {
                  id:            nextFileId(),
                  fileEventType: payload.file_event_type || "modified",
                  path:          payload.path,
                  preview:       payload.preview || "",
                  timestamp,
                };
                return [...prev, item].slice(-200);
              });
              break;

            case "agent_thought":
              setThoughts(prev => [...prev, {
                agent: payload.agent, thought: payload.thought, timestamp,
              }].slice(-50));
              break;

            case "task_complete":
              setStatus("completed");
              setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "done" } : s));
              ws.close();
              break;

            case "task_failed":
              setStatus("failed");
              setError(payload.error || "Task failed");
              setSteps(prev => prev.map(s => s.status === "running" ? { ...s, status: "error" } : s));
              ws.close();
              break;
          }
        } catch { /* skip malformed */ }
      };
    }

    connect();

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, [taskId, reset]);

  const doneSteps  = steps.filter(s => s.status === "done").length;
  const totalSteps = steps.length || 1;
  const progress   = status === "completed" ? 100
    : status === "failed"    ? Math.round((doneSteps / totalSteps) * 100)
    : steps.length > 0       ? Math.round((doneSteps / totalSteps) * 100)
    : 0;

  return { steps, output, fileEvents, thoughts, status, connected, error, progress, reset };
}
