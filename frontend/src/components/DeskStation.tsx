import type { AgentRuntimeState } from "../types";
import { AgentAvatar } from "./avatars/AgentAvatar";
import { FloatingSpeechBubble } from "./FloatingSpeechBubble";
import { FloatingExpText } from "./FloatingExpText";

interface DeskStationProps {
  agent: AgentRuntimeState;
  expDelta?: number;
}

export function DeskStation({ agent, expDelta }: DeskStationProps) {
  const { current_micro_state: microState, status_message: statusMessage } = agent;

  // React to states
  const isError = microState === "error";
  const isCompleted = microState === "completed";
  const isProcessing = ["coding", "executing", "optimizing", "testing"].includes(microState);

  // Status colors & classes
  let stateBorderColor = "border-cyber-neon/30";
  let topBgColor = "bg-cyber-panel/90";
  let frontRightBg = "bg-[#0f172a]";
  let frontLeftBg = "bg-[#0b101d]";
  let deskGlow = "shadow-[0_0_15px_rgba(95,225,255,0.15)]";
  let deskPulseClass = "";

  if (isError) {
    stateBorderColor = "border-status-error";
    topBgColor = "bg-status-error/20";
    frontRightBg = "bg-status-error/15";
    frontLeftBg = "bg-status-error/25";
    deskGlow = "shadow-[0_0_25px_rgba(217,77,77,0.5)]";
    deskPulseClass = "animate-red-alert";
  } else if (isCompleted) {
    stateBorderColor = "border-status-success";
    topBgColor = "bg-status-success/20";
    frontRightBg = "bg-status-success/15";
    frontLeftBg = "bg-status-success/25";
    deskGlow = "shadow-[0_0_25px_rgba(54,201,135,0.5)]";
    deskPulseClass = "animate-success-aura";
  } else if (isProcessing) {
    stateBorderColor = "border-status-processing";
    topBgColor = "bg-status-processing/10";
    frontRightBg = "bg-[#18110c]";
    frontLeftBg = "bg-[#0c0806]";
    deskGlow = "shadow-[0_0_20px_rgba(194,120,58,0.3)]";
    deskPulseClass = "animate-pulse-fast";
  }

  // Monitor screen contents based on state
  let monitorContent = (
    <div className="w-full h-full bg-cyan-950/40 flex items-center justify-center p-0.5 text-[7px] text-cyber-neon/80 font-mono">
      <div className="text-center">
        <div>STANDBY</div>
        <div className="text-[5px] opacity-60">GRID: READY</div>
      </div>
    </div>
  );

  if (isProcessing) {
    monitorContent = (
      <div className="w-full h-full bg-orange-950/30 flex flex-col justify-between p-0.5 text-[6px] text-status-processing font-mono overflow-hidden">
        <div className="animate-pulse">RUNNING</div>
        <div className="leading-[1.1] opacity-70">
          <div>LOC_0x7f43</div>
          <div className="text-white">COMPILING...</div>
        </div>
      </div>
    );
  } else if (isError) {
    monitorContent = (
      <div className="w-full h-full bg-red-950/60 flex flex-col justify-center items-center p-0.5 text-[7px] text-status-error font-bold font-mono animate-pulse">
        <div>⚠ WARNING</div>
        <div className="text-[5px] text-white">SYSTEM ERR</div>
      </div>
    );
  } else if (isCompleted) {
    monitorContent = (
      <div className="w-full h-full bg-emerald-950/40 flex flex-col justify-center items-center p-0.5 text-[7px] text-status-success font-bold font-mono">
        <div>✔ DONE</div>
        <div className="text-[5px] text-white/90">SUCCESS</div>
      </div>
    );
  } else if (microState === "thinking" || microState === "planning" || microState === "designing") {
    monitorContent = (
      <div className="w-full h-full bg-cyan-950/60 flex flex-col justify-between p-0.5 text-[6px] text-cyber-neon font-mono">
        <div className="flex justify-between items-center">
          <span className="animate-pulse">THINKING</span>
          <span className="w-1 h-1 bg-cyber-neon rounded-full animate-ping" />
        </div>
        <div className="h-4 flex items-end gap-[1px]">
          <div className="w-1 bg-cyber-neon h-2 animate-pulse" />
          <div className="w-1 bg-cyber-neon h-3 animate-pulse" style={{ animationDelay: "0.2s" }} />
          <div className="w-1 bg-cyber-neon h-1 animate-pulse" style={{ animationDelay: "0.4s" }} />
          <div className="w-1 bg-cyber-neon h-4 animate-pulse" style={{ animationDelay: "0.1s" }} />
        </div>
      </div>
    );
  }

  // Dimensions of the 3D Box
  const boxStyles = {
    "--box-w": "80px",
    "--box-d": "60px",
    "--box-h": "32px",
  } as React.CSSProperties;

  return (
    <div 
      className={`box-3d w-20 h-[60px] cursor-pointer transition-all duration-300 ${deskGlow}`} 
      style={boxStyles}
    >
      {/* 3D DESK BLOCK */}
      
      {/* Top Face */}
      <div 
        className={`face-3d face-top w-20 h-[60px] border-2 rounded ${stateBorderColor} ${topBgColor} ${deskPulseClass}`}
      >
        {/* Desk decoration overlay (scifi lines) */}
        <div className="absolute inset-1 border border-cyber-neon/10 rounded opacity-60 pointer-events-none" />

        {/* UPRIGHT COMPONENTS (Facing screen) */}

        {/* Holographic Monitor Screen */}
        <div 
          className="absolute left-2 top-2 w-[34px] h-[22px] upright-billboard pointer-events-none border border-cyber-neon/50 bg-[#070b14] rounded shadow-[0_0_10px_rgba(95,225,255,0.4)] overflow-hidden"
          style={{ transformOrigin: "bottom center" }}
        >
          {/* Scanline overlay for retro screen */}
          <div className="absolute inset-0 bg-scanline pointer-events-none opacity-20">
            <div className="absolute inset-x-0 h-0.5 bg-cyber-neon animate-scanline" />
          </div>
          {monitorContent}
        </div>

        {/* Floating Speech Bubble */}
        <FloatingSpeechBubble message={statusMessage} />

        {/* Floating EXP gains */}
        <FloatingExpText delta={expDelta} />

        {/* The Agent Character Avatar */}
        <div 
          className="absolute left-[34px] top-1 w-20 h-20 upright-billboard pointer-events-none flex items-end justify-center"
          style={{ transformOrigin: "bottom center" }}
        >
          <AgentAvatar agentId={agent.agent_id} microState={microState} />
        </div>

      </div>

      {/* Front-Right Face */}
      <div 
        className={`face-3d face-front-right w-20 h-8 border-r border-b ${stateBorderColor} ${frontRightBg}`} 
      />

      {/* Front-Left Face */}
      <div 
        className={`face-3d face-front-left w-[60px] h-8 border-l border-b ${stateBorderColor} ${frontLeftBg}`} 
      />

      {/* Desk Base Shadow flat on the floor */}
      <div 
        className="absolute -inset-1.5 bg-black/45 blur-md rounded-lg -z-10 translate-z-0"
      />

      {/* UPRIGHT BASE LABEL (Standing right in front of the desk) */}
      <div 
        className="absolute -bottom-8 left-1/2 -translate-x-1/2 upright-billboard z-20 flex flex-col items-center pointer-events-none w-28 text-center"
        style={{ transformOrigin: "top center" }}
      >
        <div className="bg-cyber-panel/90 border border-cyber-neon/30 px-1.5 py-0.5 rounded shadow-lg">
          <div className="text-[8px] font-bold text-slate-100 uppercase tracking-widest truncate">
            {agent.display_name.split(" / ")[0]}
          </div>
          <div className="text-[7px] text-cyber-neon/80 font-mono tracking-tight flex items-center justify-center gap-1">
            <span>EXP {agent.exp_points}</span>
            <span className="opacity-40">|</span>
            <span className="text-cyber-gold">${agent.metrics.cost_usd.toFixed(4)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
