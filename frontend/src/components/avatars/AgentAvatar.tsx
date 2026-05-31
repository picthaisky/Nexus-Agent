import type { MicroState } from "../../types";

interface AgentAvatarProps {
  agentId: string;
  microState: MicroState;
}

export function AgentAvatar({ agentId, microState }: AgentAvatarProps) {
  // Determine animation style based on state
  let stateClass = "animate-pulse-slow";
  if (microState === "coding" || microState === "executing" || microState === "optimizing") {
    stateClass = "animate-bounce";
  } else if (microState === "thinking" || microState === "planning" || microState === "designing") {
    stateClass = "animate-pulse-fast";
  } else if (microState === "error") {
    stateClass = "animate-glitch-upright";
  } else if (microState === "walking") {
    stateClass = "animate-walk-upright";
  }

  // Neon color filters for SVGs
  const svgFilters = (
    <defs>
      <filter id="neon-glow-gold" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="neon-glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="3" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="neon-glow-pink" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="neon-glow-green" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      <filter id="neon-glow-orange" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
      {/* Background neon grid pattern */}
      <pattern id="cardGrid" width="10" height="10" patternUnits="userSpaceOnUse">
        <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(95,225,255,0.08)" strokeWidth="0.5" />
      </pattern>
    </defs>
  );

  switch (agentId) {
    case "planner":
      // เสนาบดีไซเบอร์ (Planner) - Chada crown + decree scroll + gold aura
      return (
        <div className={`relative w-28 h-28 flex items-center justify-center ${stateClass}`}>
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">
            {svgFilters}
            {/* Background Halo */}
            <circle cx="50" cy="50" r="38" fill="none" stroke="#d4af37" strokeWidth="1" strokeDasharray="3, 5" className="animate-spin-slow" />
            <circle cx="50" cy="50" r="32" fill="none" stroke="#d4af37" strokeWidth="0.5" opacity="0.5" />
            
            {/* Throne Seat/Base */}
            <path d="M 25 80 L 75 80 L 70 88 L 30 88 Z" fill="#0f1626" stroke="#d4af37" strokeWidth="1.5" />
            <line x1="35" y1="84" x2="65" y2="84" stroke="#5fe1ff" strokeWidth="1" opacity="0.7" />

            {/* Body */}
            <path d="M 35 80 L 50 48 L 65 80 Z" fill="url(#plannerBodyGrad)" stroke="#d4af37" strokeWidth="1" />
            <linearGradient id="plannerBodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#1e293b" />
              <stop offset="100%" stopColor="#d4af37" stopOpacity="0.3" />
            </linearGradient>

            {/* Decree Scroll (Hologram) */}
            <g transform="translate(18, 52) rotate(-15)" className="animate-pulse">
              <rect x="0" y="0" width="16" height="24" rx="2" fill="rgba(95,225,255,0.15)" stroke="#5fe1ff" strokeWidth="1" filter="url(#neon-glow-cyan)" />
              <line x1="3" y1="6" x2="13" y2="6" stroke="#5fe1ff" strokeWidth="1.5" />
              <line x1="3" y1="12" x2="11" y2="12" stroke="#5fe1ff" strokeWidth="1" />
              <line x1="3" y1="18" x2="13" y2="18" stroke="#5fe1ff" strokeWidth="1" />
            </g>

            {/* Head */}
            <circle cx="50" cy="42" r="8" fill="#1e293b" stroke="#d4af37" strokeWidth="1.5" />
            
            {/* Chada Crown (Thai traditional tall pointed crown) */}
            <path d="M 45 36 L 50 12 L 55 36 L 52 38 L 48 38 Z" fill="#0f1626" stroke="#d4af37" strokeWidth="1.5" filter="url(#neon-glow-gold)" />
            {/* Crown levels */}
            <line x1="47" y1="28" x2="53" y2="28" stroke="#d4af37" strokeWidth="1.5" />
            <line x1="48" y1="20" x2="52" y2="20" stroke="#d4af37" strokeWidth="1.5" />
            <circle cx="50" cy="10" r="1.5" fill="#5fe1ff" />
          </svg>
        </div>
      );

    case "architect":
      // พระวิศวกรรม (Architect) - Orbiting geometric rings + tools
      return (
        <div className={`relative w-28 h-28 flex items-center justify-center ${stateClass}`}>
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(95,225,255,0.4)]">
            {svgFilters}
            {/* Outer Orbiting Rings (Blueprint style) */}
            <circle cx="50" cy="50" r="42" fill="none" stroke="#5fe1ff" strokeWidth="1" strokeDasharray="8, 4" className="animate-spin-slow" />
            <rect x="18" y="18" width="64" height="64" rx="4" fill="none" stroke="#5fe1ff" strokeWidth="0.5" strokeDasharray="3, 10" opacity="0.4" />
            
            {/* Body */}
            <path d="M 32 80 L 50 45 L 68 80 Z" fill="#0f1626" stroke="#5fe1ff" strokeWidth="1.5" />
            <line x1="50" y1="45" x2="50" y2="80" stroke="#5fe1ff" strokeWidth="1" strokeDasharray="2, 2" opacity="0.7" />

            {/* Mechanical Arms/Tools */}
            {/* Left Arm: Compass */}
            <path d="M 38 60 L 22 52 L 18 64" fill="none" stroke="#5fe1ff" strokeWidth="1.5" filter="url(#neon-glow-cyan)" />
            {/* Right Arm: Tri-square ruler */}
            <path d="M 62 60 L 78 54 L 84 70 Z" fill="none" stroke="#5fe1ff" strokeWidth="1.5" filter="url(#neon-glow-cyan)" />

            {/* Head & Engineering Visor */}
            <circle cx="50" cy="40" r="9" fill="#111827" stroke="#5fe1ff" strokeWidth="1.5" />
            <rect x="44" y="37" width="12" height="4" rx="1" fill="#5fe1ff" filter="url(#neon-glow-cyan)" />
            
            {/* Crown decoration (Vishvakarma helmet) */}
            <path d="M 44 32 L 50 20 L 56 32 Z" fill="#111827" stroke="#5fe1ff" strokeWidth="1" />
            <circle cx="50" cy="19" r="2" fill="#5fe1ff" />
          </svg>
        </div>
      );

    case "developer":
      // วานรล้ำยุค / หนุมานไซเบอร์ (Developer) - Cybernetic monkey visor + holographic keyb
      return (
        <div className={`relative w-28 h-28 flex items-center justify-center ${stateClass}`}>
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(194,120,58,0.4)]">
            {svgFilters}
            {/* Speed Matrix Background */}
            <path d="M 20 20 L 30 10 M 80 20 L 70 10 M 20 80 L 30 90 M 80 80 L 70 90" stroke="#c2783a" strokeWidth="1" opacity="0.4" />
            <circle cx="50" cy="50" r="35" fill="none" stroke="#c2783a" strokeWidth="0.5" strokeDasharray="1, 8" />

            {/* Tail (Cybernetic Wire) */}
            <path d="M 32 80 C 10 90, 5 60, 20 50 C 25 45, 22 35, 12 40" fill="none" stroke="#c2783a" strokeWidth="2.5" strokeDasharray="3, 1" filter="url(#neon-glow-orange)" />

            {/* Body */}
            <path d="M 30 82 L 40 50 L 60 50 L 70 82 Z" fill="#111827" stroke="#c2783a" strokeWidth="1.5" />
            <rect x="42" y="58" width="16" height="18" fill="#c2783a" opacity="0.2" rx="1" />

            {/* Hanuman visored Head */}
            <circle cx="50" cy="42" r="10" fill="#111827" stroke="#c2783a" strokeWidth="1.5" />
            {/* Visor face */}
            <path d="M 43 40 L 57 40 L 55 48 L 45 48 Z" fill="#c2783a" filter="url(#neon-glow-orange)" />
            {/* Monkey ears */}
            <path d="M 38 42 Q 35 38 38 34" fill="none" stroke="#c2783a" strokeWidth="2" />
            <path d="M 62 42 Q 65 38 62 34" fill="none" stroke="#c2783a" strokeWidth="2" />

            {/* Cyber crown (Chuchia crest) */}
            <path d="M 48 32 Q 50 22 55 24 Q 52 30 52 32 Z" fill="#c2783a" stroke="#c2783a" strokeWidth="1" />

            {/* Typing Hologram Screen */}
            <g transform="translate(25, 76)">
              <polygon points="0,0 50,0 45,8 5,8" fill="rgba(194,120,58,0.3)" stroke="#c2783a" strokeWidth="1.5" filter="url(#neon-glow-orange)" />
              <line x1="8" y1="4" x2="42" y2="4" stroke="#fff" strokeWidth="1.5" strokeDasharray="2, 3" className="animate-pulse" />
            </g>
          </svg>
        </div>
      );

    case "ui_weaver":
      // นางอัปสรทอแสง (UI Weaver) - Floating pink lotus + ribbons
      return (
        <div className={`relative w-28 h-28 flex items-center justify-center ${stateClass}`}>
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(244,114,182,0.4)]">
            {svgFilters}
            {/* Floating Sparkles */}
            <circle cx="20" cy="30" r="1.5" fill="#f472b6" className="animate-pulse" />
            <circle cx="82" cy="42" r="2" fill="#f472b6" className="animate-pulse" />
            <circle cx="35" cy="18" r="1" fill="#fff" className="animate-pulse" />

            {/* Swirling ribbons (Pixel weaving paths) */}
            <path d="M 12 75 C 20 40, 80 40, 88 75" fill="none" stroke="#f472b6" strokeWidth="1.5" strokeDasharray="5, 3" filter="url(#neon-glow-pink)" className="animate-pulse-slow" />
            <path d="M 22 45 C 50 15, 50 85, 78 45" fill="none" stroke="#f472b6" strokeWidth="1" opacity="0.6" />

            {/* Lotus Throne */}
            <path d="M 25 80 Q 50 68 75 80 Q 50 92 25 80 Z" fill="#1e1b29" stroke="#f472b6" strokeWidth="2" filter="url(#neon-glow-pink)" />
            {/* Lotus Petals */}
            <path d="M 32 76 Q 22 62 36 68" fill="none" stroke="#f472b6" strokeWidth="1.5" />
            <path d="M 68 76 Q 78 62 64 68" fill="none" stroke="#f472b6" strokeWidth="1.5" />
            <path d="M 50 71 Q 50 56 46 62 Q 50 71 54 62 Z" fill="#f472b6" opacity="0.9" />

            {/* Body (Dancer) */}
            <path d="M 42 75 L 50 50 L 58 75 Z" fill="#111827" stroke="#f472b6" strokeWidth="1.2" />
            
            {/* Head & Crown decoration */}
            <circle cx="50" cy="44" r="7" fill="#111827" stroke="#f472b6" strokeWidth="1.5" />
            <path d="M 46 38 Q 50 24 54 38 Z" fill="#f472b6" filter="url(#neon-glow-pink)" />
            <circle cx="50" cy="23" r="1.5" fill="#fff" />
          </svg>
        </div>
      );

    case "validator":
      // ยักษ์ทวารบาล (Validator) - Giant gatekeeper demon helmet + digital shield
      return (
        <div className={`relative w-28 h-28 flex items-center justify-center ${stateClass}`}>
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(54,201,135,0.4)]">
            {svgFilters}
            {/* Scanning Radar Grid */}
            <path d="M 15 75 L 85 75" stroke="#36c987" strokeWidth="1" strokeDasharray="3, 3" opacity="0.5" />
            <path d="M 25 15 L 75 15 L 85 85 L 15 85 Z" fill="none" stroke="#36c987" strokeWidth="0.5" opacity="0.2" />

            {/* Bulky Body */}
            <path d="M 24 82 L 40 45 L 60 45 L 76 82 Z" fill="#111827" stroke="#36c987" strokeWidth="2" />
            <path d="M 38 58 L 62 58 L 60 80 L 40 80 Z" fill="#36c987" opacity="0.15" />

            {/* Validator Shield Gate */}
            <g transform="translate(62, 54)">
              <rect x="0" y="0" width="22" height="28" rx="3" fill="rgba(54,201,135,0.2)" stroke="#36c987" strokeWidth="2" filter="url(#neon-glow-green)" />
              <path d="M 4 8 L 18 20 M 18 8 L 4 20" stroke="#36c987" strokeWidth="1.5" opacity="0.8" />
              <circle cx="11" cy="14" r="4" fill="none" stroke="#36c987" strokeWidth="1.5" />
            </g>

            {/* Demon Helmet (Yaksa) */}
            <circle cx="50" cy="38" r="10" fill="#111827" stroke="#36c987" strokeWidth="2" />
            {/* Glowing red/orange demon eyes inside dark helmet */}
            <circle cx="46" cy="38" r="2.2" fill="#d94d4d" filter="url(#neon-glow-gold)" />
            <circle cx="54" cy="38" r="2.2" fill="#d94d4d" filter="url(#neon-glow-gold)" />
            {/* Tusks (Fangs) */}
            <path d="M 44 42 Q 44 46 47 43" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
            <path d="M 56 42 Q 56 46 53 43" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />

            {/* Tall spike crown */}
            <path d="M 43 30 L 50 8 L 57 30 Z" fill="#111827" stroke="#36c987" strokeWidth="1.5" filter="url(#neon-glow-green)" />
            <line x1="47" y1="22" x2="53" y2="22" stroke="#36c987" strokeWidth="1.5" />
          </svg>
        </div>
      );

    case "optimizer":
      // ฤาษีดิจิทัล (Optimizer) - Levitating hermit + infinity halo
      return (
        <div className={`relative w-28 h-28 flex items-center justify-center ${stateClass}`}>
          <svg viewBox="0 0 100 100" className="w-full h-full drop-shadow-[0_0_15px_rgba(212,175,55,0.4)]">
            {svgFilters}
            {/* Cloud/Steam levitation ring */}
            <ellipse cx="50" cy="84" rx="28" ry="8" fill="rgba(212,175,55,0.1)" stroke="#d4af37" strokeWidth="1" strokeDasharray="4, 4" className="animate-spin-slow" />
            <ellipse cx="50" cy="84" rx="18" ry="5" fill="none" stroke="#d4af37" strokeWidth="0.5" opacity="0.6" />

            {/* Body (Cross-legged meditation stance) */}
            <path d="M 32 76 C 32 62, 40 48, 50 48 C 60 48, 68 62, 68 76 C 60 82, 40 82, 32 76 Z" fill="#111827" stroke="#d4af37" strokeWidth="1.5" />
            <path d="M 26 78 C 35 70, 65 70, 74 78" fill="none" stroke="#d4af37" strokeWidth="2.5" strokeLinecap="round" />

            {/* Hermit Head with long digital beard */}
            <circle cx="50" cy="38" r="8" fill="#111827" stroke="#d4af37" strokeWidth="1.5" />
            {/* Digital Beard (Cascading gold lines) */}
            <path d="M 44 42 L 50 62 L 56 42 L 50 46 Z" fill="#d4af37" opacity="0.8" filter="url(#neon-glow-gold)" />

            {/* Tall pointed hermit hat */}
            <path d="M 44 32 Q 50 14 53 18 Q 50 26 50 32 Z" fill="#111827" stroke="#d4af37" strokeWidth="1.5" />
            <circle cx="53" cy="18" r="2" fill="#5fe1ff" />

            {/* Levitating Golden Infinity Symbol (The Optimizer Loop) */}
            <g transform="translate(32, 8)">
              <path d="M 6 12 C -2 3, 10 3, 18 12 C 26 21, 38 21, 30 12 C 22 3, 14 21, 6 12 Z" fill="none" stroke="#d4af37" strokeWidth="2" filter="url(#neon-glow-gold)" className="animate-pulse" />
            </g>
          </svg>
        </div>
      );

    default:
      return null;
  }
}
