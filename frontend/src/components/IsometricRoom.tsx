import { useEffect, useRef, useState } from "react";
import type { AgentRuntimeState } from "../types";
import { ExpFx } from "../hooks/useAgentSocket";
import { DeskStation } from "./DeskStation";

interface IsometricRoomProps {
  agents: Record<string, AgentRuntimeState>;
  expEffects: ExpFx[];
}

const ROSTER_ORDER = ["planner", "architect", "developer", "ui_weaver", "validator", "optimizer"];

const AGENT_COORDS: Record<string, { left: number; top: number }> = {
  planner:   { left: 30,  top: 30 },
  architect: { left: 190, top: 30 },
  developer: { left: 350, top: 30 },
  ui_weaver: { left: 30,  top: 170 },
  validator: { left: 190, top: 170 },
  optimizer: { left: 350, top: 170 },
};

export function IsometricRoom({ agents, expEffects }: IsometricRoomProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  // Responsive scaling logic
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        // Room base dimensions is 460px + padding ~ 520px
        const baseWidth = 530;
        const calculatedScale = Math.min(1.1, Math.max(0.45, width / baseWidth));
        setScale(calculatedScale);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-[380px] md:h-[450px] lg:h-[500px] flex items-center justify-center overflow-hidden border border-cyber-neon/15 bg-cyber-panel/30 rounded-2xl shadow-2xl backdrop-blur-sm"
    >
      {/* Sci-Fi Decorative Grid Header */}
      <div className="absolute top-3 left-4 text-[10px] font-mono text-cyber-neon/60 select-none pointer-events-none uppercase tracking-[0.15em] flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-cyber-neon rounded-full animate-ping" />
        <span>SYS_MODEL // CYBER-THAI_OFFICE_2.5D</span>
      </div>

      {/* 3D Isometric Viewport */}
      <div className="isometric-viewport w-full h-full flex items-center justify-center">
        
        {/* The Rotated Floor */}
        <div 
          className="isometric-floor relative w-[460px] h-[280px] rounded-xl border-2 border-cyber-neon/30 select-none"
          style={{ 
            transform: `scale(${scale}) rotateX(60deg) rotateZ(-45deg)`,
            boxShadow: "0 0 40px rgba(95,225,255,0.08), inset 0 0 30px rgba(95,225,255,0.05)"
          }}
        >
          
          {/* Cyber-Thai Traditional Grid Overlay (Lying flat on the floor) */}
          <div className="absolute inset-0 w-full h-full pointer-events-none rounded-xl overflow-hidden">
            <svg className="w-full h-full opacity-40" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="floorGrad" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#0f172a" stopOpacity="0.1" />
                  <stop offset="100%" stopColor="#030712" stopOpacity="0.9" />
                </radialGradient>
              </defs>
              <rect width="100%" height="100%" fill="url(#floorGrad)" />
              
              {/* Corner Traditional Thai-styled Borders */}
              <path d="M 0,25 Q 25,25 25,0 M 435,25 Q 410,25 410,0 M 0,255 Q 25,255 25,280 M 435,255 Q 410,255 410,280" fill="none" stroke="#d4af37" strokeWidth="2.5" opacity="0.6" filter="drop-shadow(0 0 2px #d4af37)" />
              <circle cx="25" cy="25" r="2" fill="#5fe1ff" />
              <circle cx="435" cy="25" r="2" fill="#5fe1ff" />
              <circle cx="25" cy="255" r="2" fill="#5fe1ff" />
              <circle cx="435" cy="255" r="2" fill="#5fe1ff" />

              {/* Grid Lines */}
              {Array.from({ length: 11 }).map((_, i) => (
                <line key={`x-${i}`} x1={i * 46} y1="0" x2={i * 46} y2="280" stroke="#5fe1ff" strokeWidth="0.5" opacity="0.15" />
              ))}
              {Array.from({ length: 7 }).map((_, i) => (
                <line key={`y-${i}`} x1="0" y1={i * 40} x2="460" y2={i * 40} stroke="#5fe1ff" strokeWidth="0.5" opacity="0.15" />
              ))}

              {/* Center Cyber Mandala */}
              <circle cx="230" cy="140" r="38" fill="none" stroke="#d4af37" strokeWidth="0.75" strokeDasharray="4, 3" />
              <polygon points="230,110 260,140 230,170 200,140" fill="none" stroke="#5fe1ff" strokeWidth="1.25" opacity="0.4" />
            </svg>
          </div>

          {/* RENDER THE SIX AGENT DESK STATIONS */}
          {ROSTER_ORDER.map((id) => {
            const agent = agents[id];
            if (!agent) return null;

            const coords = AGENT_COORDS[id] || { left: 0, top: 0 };
            
            // Check if there is an active EXP effect for this agent
            const expFx = expEffects.find((x) => x.agent_id === id);

            return (
              <div 
                key={id}
                className="absolute z-10"
                style={{ 
                  left: `${coords.left}px`,
                  top: `${coords.top}px`
                }}
              >
                <DeskStation agent={agent} expDelta={expFx?.delta} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
