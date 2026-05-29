import type { MicroState } from "../types";

/** Map a micro-state to a status palette token + display label. */
export function microStyle(state: MicroState): {
  ring: string;          // ring color class
  glow: string;          // shadow/glow color class
  badge: string;         // bg badge color
  label: string;
  anim: string;          // animation speed
} {
  switch (state) {
    case "idle":
      return { ring: "ring-status-standby/60",   glow: "shadow-[0_0_30px_-5px_#1d83b8]", badge: "bg-status-standby/30",    label: "STANDBY",   anim: "animate-pulse-slow" };
    case "thinking":
    case "planning":
    case "designing":
      return { ring: "ring-cyber-neon/70",       glow: "shadow-[0_0_30px_-5px_#5fe1ff]", badge: "bg-cyber-neon/30",        label: state.toUpperCase(), anim: "animate-pulse" };
    case "coding":
    case "executing":
    case "optimizing":
    case "testing":
      return { ring: "ring-status-processing/80",glow: "shadow-[0_0_36px_-4px_#c2783a]", badge: "bg-status-processing/40", label: state.toUpperCase(), anim: "animate-pulse-fast" };
    case "completed":
      return { ring: "ring-status-success/80",   glow: "shadow-[0_0_40px_-3px_#36c987]", badge: "bg-status-success/40",    label: "DONE",      anim: "animate-pulse-slow" };
    case "waiting_for_human":
      return { ring: "ring-cyber-gold/80",       glow: "shadow-[0_0_30px_-3px_#d4af37]", badge: "bg-cyber-gold/40",        label: "WAITING",   anim: "animate-pulse-slow" };
    case "error":
      return { ring: "ring-status-error/90",     glow: "shadow-[0_0_40px_-2px_#d94d4d]", badge: "bg-status-error/50",      label: "ERROR",     anim: "animate-pulse-fast" };
  }
}
