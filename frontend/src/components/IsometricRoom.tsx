import { useEffect, useRef } from "react";
import type { AgentRuntimeState } from "../types";
import { ExpFx } from "../hooks/useAgentSocket";
import { PhaserGame, IRefPhaserGame } from "../game/PhaserGame";
import { EventBus } from "../game/EventBus";

interface IsometricRoomProps {
  agents: Record<string, AgentRuntimeState>;
  expEffects: ExpFx[];
}

export function IsometricRoom({ agents, expEffects }: IsometricRoomProps) {
  const phaserRef = useRef<IRefPhaserGame | null>(null);

  // Sync React state to Phaser whenever agents change or when scene becomes ready
  useEffect(() => {
    EventBus.emit('update-agents', agents);

    const onSceneReady = () => {
        EventBus.emit('update-agents', agents);
    };
    EventBus.on('current-scene-ready', onSceneReady);

    return () => {
        EventBus.removeListener('current-scene-ready', onSceneReady);
    };
  }, [agents]);

  // Sync EXP effects to Phaser (if we want to add flying text in Phaser later)
  useEffect(() => {
    if (expEffects.length > 0) {
        EventBus.emit('exp-effects', expEffects);
    }
  }, [expEffects]);

  return (
    <div className="relative w-full h-[380px] md:h-[450px] lg:h-[500px] flex items-center justify-center overflow-hidden border border-cyber-neon/15 bg-cyber-panel/30 rounded-2xl shadow-2xl backdrop-blur-sm">
      {/* Sci-Fi Decorative Grid Header */}
      <div className="absolute top-3 left-4 text-[10px] font-mono text-cyber-neon/60 select-none pointer-events-none uppercase tracking-[0.15em] flex items-center gap-2 z-10">
        <span className="w-1.5 h-1.5 bg-cyber-neon rounded-full animate-ping" />
        <span>SYS_MODEL // CYBER-THAI_OFFICE_2.5D_PHASER</span>
      </div>

      {/* The Phaser Canvas Container */}
      <div className="w-full h-full relative cursor-grab active:cursor-grabbing">
          <PhaserGame ref={phaserRef} />
      </div>
    </div>
  );
}
