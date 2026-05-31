import React from "react";

interface IsometricDeskProps {
  color?: "cyan" | "magenta" | "gold" | "green" | "red";
  width?: number;
  depth?: number;
  height?: number;
}

export function IsometricDesk({
  color = "cyan",
  width = 120,
  depth = 80,
  height = 40,
}: IsometricDeskProps) {
  // Map color strings to specific Tailwind hex values for inline styling
  const colorMap = {
    cyan: { top: "#0ff", side: "#088", front: "#0cc" },
    magenta: { top: "#f0f", side: "#808", front: "#c0c" },
    gold: { top: "#fbbf24", side: "#b45309", front: "#d97706" },
    green: { top: "#4ade80", side: "#166534", front: "#22c55e" },
    red: { top: "#f87171", side: "#991b1b", front: "#dc2626" },
  };

  const theme = colorMap[color] || colorMap.cyan;

  return (
    <div
      className="relative pointer-events-none"
      style={{
        width: `${width}px`,
        height: `${depth}px`,
        transformStyle: "preserve-3d",
      }}
    >
      {/* Top Face */}
      <div
        className="absolute top-0 left-0 border border-white/20 backdrop-blur-sm flex items-center justify-center overflow-hidden"
        style={{
          width: `${width}px`,
          height: `${depth}px`,
          backgroundColor: `${theme.top}20`, // 20% opacity
          boxShadow: `inset 0 0 15px ${theme.top}50, 0 0 20px ${theme.top}40`,
          transform: `translateZ(${height}px)`,
        }}
      >
        {/* Grid pattern on top of the desk */}
        <div
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage: `linear-gradient(${theme.top} 1px, transparent 1px), linear-gradient(90deg, ${theme.top} 1px, transparent 1px)`,
            backgroundSize: "10px 10px",
          }}
        />
      </div>

      {/* Front Face (Facing Bottom-Right in Isometric) */}
      <div
        className="absolute bottom-0 left-0 border border-white/10"
        style={{
          width: `${width}px`,
          height: `${height}px`,
          backgroundColor: `${theme.front}40`,
          transformOrigin: "bottom",
          transform: `rotateX(-90deg) translateZ(${depth - height}px)`,
        }}
      />

      {/* Right Face (Facing Bottom-Left in Isometric) */}
      <div
        className="absolute top-0 right-0 border border-white/10"
        style={{
          width: `${depth}px`,
          height: `${height}px`,
          backgroundColor: `${theme.side}60`,
          transformOrigin: "right",
          transform: `rotateY(90deg) translateZ(${width - depth}px)`,
        }}
      />
      
      {/* Glow Effect under the desk */}
       <div
        className="absolute top-1/2 left-1/2 w-full h-full rounded-full blur-2xl -z-10"
        style={{
          backgroundColor: theme.top,
          transform: "translate(-50%, -50%) translateZ(0)",
          opacity: 0.15,
        }}
      />
    </div>
  );
}
