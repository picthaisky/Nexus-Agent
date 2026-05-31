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
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setScale(prev => Math.min(2.5, Math.max(0.3, prev - e.deltaY * 0.001)));
  };

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
      className="relative w-full h-[380px] md:h-[450px] lg:h-[500px] flex items-center justify-center overflow-hidden border border-cyber-neon/15 bg-cyber-panel/30 rounded-2xl shadow-2xl backdrop-blur-sm cursor-grab active:cursor-grabbing"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
    >
      {/* Sci-Fi Decorative Grid Header */}
      <div className="absolute top-3 left-4 text-[10px] font-mono text-cyber-neon/60 select-none pointer-events-none uppercase tracking-[0.15em] flex items-center gap-2">
        <span className="w-1.5 h-1.5 bg-cyber-neon rounded-full animate-ping" />
        <span>SYS_MODEL // CYBER-THAI_OFFICE_2.5D</span>
      </div>

      {/* 3D Isometric Viewport */}
      <div 
        className="isometric-viewport w-full h-full flex items-center justify-center"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
      >
        
        {/* The Rotated Floor Assembly */}
        <div 
          className="relative w-[460px] h-[280px] select-none"
          style={{ 
            transform: `scale(${scale}) rotateX(60deg) rotateZ(-45deg)`,
            transformStyle: "preserve-3d",
          }}
        >
          {/* Floor Depth (Front-Right Face) */}
          <div 
            className="absolute bottom-0 left-0 border-r border-b border-cyber-neon/20 bg-slate-900/80"
            style={{
              width: "460px",
              height: "20px",
              transformOrigin: "bottom",
              transform: "rotateX(-90deg) translateZ(280px)",
            }}
          />
          {/* Floor Depth (Front-Left Face) */}
          <div 
            className="absolute top-0 left-0 border-l border-b border-cyber-neon/20 bg-slate-900/90"
            style={{
              width: "20px",
              height: "280px",
              transformOrigin: "left",
              transform: "rotateY(90deg) translateZ(0)",
            }}
          />

          {/* Floor Surface */}
          <div className="absolute inset-0 w-full h-full rounded-xl border-2 border-cyber-neon/30 bg-[radial-gradient(circle_at_center,rgba(15,22,38,0.95)_0%,rgba(7,11,20,0.98)_100%)] shadow-[0_0_40px_rgba(95,225,255,0.08),inset_0_0_30px_rgba(95,225,255,0.05)] transform-style-preserve-3d overflow-hidden">
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
            const expFx = expEffects.find((x) => x.agent_id === id);

            return (
              <div 
                key={id}
                className="absolute z-10"
                style={{ 
                  left: `${coords.left}px`,
                  top: `${coords.top}px`,
                  transform: "translateZ(1px)" // Lift slightly above floor
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
