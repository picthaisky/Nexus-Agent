interface FloatingExpTextProps {
  delta?: number;
}

export function FloatingExpText({ delta }: FloatingExpTextProps) {
  if (!delta) return null;
  return (
    <div className="pointer-events-none absolute -top-20 left-1/2 -translate-x-1/2 z-[110] font-mono text-lg font-extrabold text-status-success whitespace-nowrap animate-exp-popup drop-shadow-[0_0_10px_rgba(54,201,135,0.9)]">
      +{delta} EXP
    </div>
  );
}
