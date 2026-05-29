import type { MicroState } from "../../types";
import {
  Crown,        // Planner
  Hammer,       // Architect
  Code2,        // Developer
  Sparkles,     // UI Weaver
  Shield,       // Validator
  Infinity as InfinityIcon, // Optimizer
} from "lucide-react";
import { microStyle } from "../../utils/microStyle";

interface AvatarProps {
  microState: MicroState;
}

/** Base wrapper: glowing rounded medallion with state-driven aura. */
function Medallion({
  microState,
  children,
  ringExtra = "",
}: {
  microState: MicroState;
  children: React.ReactNode;
  ringExtra?: string;
}) {
  const s = microStyle(microState);
  return (
    <div
      className={[
        "relative h-32 w-32 rounded-full bg-cyber-panel/80 backdrop-blur",
        "flex items-center justify-center ring-4 ring-offset-2 ring-offset-cyber-bg",
        s.ring,
        s.glow,
        s.anim,
        ringExtra,
      ].join(" ")}
    >
      {/* scanline overlay for sci-fi feel */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        <div className="absolute inset-x-0 h-0.5 bg-cyber-neon/70 animate-scanline" />
      </div>
      {children}
    </div>
  );
}

export function PlannerAvatar({ microState }: AvatarProps) {
  // เสนาบดีไซเบอร์: holographic decree scroll behind a crown.
  return (
    <Medallion microState={microState}>
      <div className="absolute inset-3 rounded-full border border-cyber-gold/40 animate-spin-slow" />
      <Crown className="h-12 w-12 text-cyber-gold drop-shadow-[0_0_8px_rgba(212,175,55,0.6)]" />
    </Medallion>
  );
}

export function ArchitectAvatar({ microState }: AvatarProps) {
  // พระวิศวกรรม: orbiting data rings.
  return (
    <Medallion microState={microState}>
      <div className="absolute inset-1 rounded-full border-2 border-cyber-neon/40 animate-spin-slow" />
      <div className="absolute inset-4 rounded-full border border-cyber-neon/60 animate-spin-fast" />
      <Hammer className="h-12 w-12 text-cyber-neon drop-shadow-[0_0_8px_rgba(95,225,255,0.6)]" />
    </Medallion>
  );
}

export function DeveloperAvatar({ microState }: AvatarProps) {
  // วานรล้ำยุค: code racing across the chassis.
  const speed = microState === "coding" || microState === "executing" ? "animate-spin-fast" : "animate-spin-slow";
  return (
    <Medallion microState={microState}>
      <div className={`absolute inset-2 rounded-full border-l-2 border-status-processing ${speed}`} />
      <Code2 className="h-12 w-12 text-status-processing drop-shadow-[0_0_8px_rgba(194,120,58,0.7)]" />
    </Medallion>
  );
}

export function UIWeaverAvatar({ microState }: AvatarProps) {
  // นางอัปสรทอแสง: floating particles.
  return (
    <Medallion microState={microState}>
      {[0, 120, 240].map((deg, i) => (
        <span
          key={i}
          className="absolute h-2 w-2 rounded-full bg-pink-300/80 animate-pulse"
          style={{ transform: `rotate(${deg}deg) translateY(-46px)` }}
        />
      ))}
      <Sparkles className="h-12 w-12 text-pink-300 drop-shadow-[0_0_8px_rgba(244,114,182,0.6)]" />
    </Medallion>
  );
}

export function ValidatorAvatar({ microState }: AvatarProps) {
  // ยักษ์ทวารบาล: armored scanner gate.
  return (
    <Medallion microState={microState}>
      <div className="absolute inset-2 rounded-full border-2 border-status-success/40" />
      <Shield className="h-12 w-12 text-status-success drop-shadow-[0_0_8px_rgba(54,201,135,0.6)]" />
    </Medallion>
  );
}

export function OptimizerAvatar({ microState }: AvatarProps) {
  // ฤาษีดิจิทัล: levitating with rotating metric halo.
  return (
    <Medallion microState={microState}>
      <div className="absolute inset-0 rounded-full border border-dashed border-cyber-gold/60 animate-spin-slow" />
      <InfinityIcon className="h-12 w-12 text-cyber-gold drop-shadow-[0_0_8px_rgba(212,175,55,0.6)]" />
    </Medallion>
  );
}

/** Map agent_id → avatar component. */
export const AVATAR_MAP: Record<string, React.FC<AvatarProps>> = {
  planner:   PlannerAvatar,
  architect: ArchitectAvatar,
  developer: DeveloperAvatar,
  ui_weaver: UIWeaverAvatar,
  validator: ValidatorAvatar,
  optimizer: OptimizerAvatar,
};
