import { useEffect, useState } from "react";

interface FloatingSpeechBubbleProps {
  message: string;
}

export function FloatingSpeechBubble({ message }: FloatingSpeechBubbleProps) {
  const [visible, setVisible] = useState(false);
  const [typedText, setTypedText] = useState("");

  useEffect(() => {
    if (!message || message.trim() === "" || message === "Task completed" || message === "Task failed") {
      setVisible(false);
      return;
    }

    setVisible(true);
    setTypedText("");

    // Typewriter effect
    let i = 0;
    const text = message;
    const interval = setInterval(() => {
      setTypedText(text.slice(0, i + 1));
      i++;
      if (i >= text.length) {
        clearInterval(interval);
      }
    }, 20);

    // Timeout to hide after 4.5 seconds
    const timeout = setTimeout(() => {
      setVisible(false);
    }, 4500);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [message]);

  if (!visible || !typedText) return null;

  return (
    <div className="absolute -top-14 left-1/2 -translate-x-1/2 z-[100] w-48 pointer-events-none transition-all duration-300 transform origin-bottom scale-95 opacity-100">
      <div className="relative bg-cyber-panel/95 border border-cyber-neon/40 text-cyber-neon text-[10px] leading-tight font-mono rounded-lg p-2 shadow-[0_0_15px_rgba(95,225,255,0.3)] text-center">
        {/* Tiny scanline effect in speech bubble */}
        <div className="absolute inset-0 overflow-hidden rounded-lg opacity-10">
          <div className="w-full h-0.5 bg-cyber-neon animate-scanline" />
        </div>
        <span className="relative z-10">{typedText}</span>
        <span className="relative z-10 text-cyber-neon/70 ml-0.5 animate-pulse">▍</span>
        
        {/* Pointer arrow */}
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-cyber-panel" />
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-cyber-neon/40 -translate-y-[1px] -z-10" />
      </div>
    </div>
  );
}
