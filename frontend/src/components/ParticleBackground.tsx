/**
 * ParticleBackground — GPU-friendly canvas particle system.
 *
 * Modes
 * -----
 * neural     Nodes connected by lines — looks like a neural network
 * galaxy     Spiral rotation of particles
 * matrix     Falling columns of glowing dots
 * float      Quiet ambient drift (default, low CPU)
 *
 * The canvas is absolutely positioned behind all content and does not
 * capture pointer events.
 */
import { useEffect, useRef, useCallback } from "react";

export type ParticleMode = "neural" | "galaxy" | "matrix" | "float";

interface ParticleConfig {
  mode?:           ParticleMode;
  count?:          number;       // particle count (default 60)
  color?:          string;       // primary color hex (default "#5fe1ff")
  accentColor?:    string;       // secondary color for connections
  speed?:          number;       // 0-2 (default 0.4)
  connectionDist?: number;       // max px for neural connections (default 120)
  glowIntensity?:  number;       // 0-1 blur glow (default 0.4)
  interactive?:    boolean;      // mouse repulsion (default true)
  opacity?:        number;       // canvas overlay opacity (default 0.6)
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  r: number;              // radius
  alpha: number;
  phase: number;          // for pulsing
  col: string;
  // matrix mode
  col_idx?: number;
  row?: number;
  speed?: number;
}

const HEX_COLORS = {
  neon:    "#5fe1ff",
  gold:    "#d4af37",
  success: "#36c987",
  error:   "#d94d4d",
  purple:  "#9b59b6",
};

export function ParticleBackground({
  mode           = "neural",
  count          = 55,
  color          = HEX_COLORS.neon,
  accentColor    = HEX_COLORS.gold,
  speed          = 0.35,
  connectionDist = 130,
  glowIntensity  = 0.5,
  interactive    = true,
  opacity        = 0.55,
}: ParticleConfig) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const animRef     = useRef<number>(0);
  const mouseRef    = useRef({ x: -9999, y: -9999 });
  const particles   = useRef<Particle[]>([]);

  // ── Hex → RGBA ─────────────────────────────────────────────────────────────
  const hexToRgba = useCallback((hex: string, a: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }, []);

  // ── Init particles ─────────────────────────────────────────────────────────
  const initParticles = useCallback((w: number, h: number) => {
    particles.current = [];

    if (mode === "matrix") {
      const cols = Math.floor(w / 18);
      for (let c = 0; c < cols; c++) {
        particles.current.push({
          x: c * 18 + 9, y: Math.random() * h,
          vx: 0, vy: 0,
          r: 3, alpha: Math.random() * 0.8 + 0.2,
          phase: Math.random() * Math.PI * 2,
          col: color,
          col_idx: c,
          row: Math.floor(Math.random() * 30),
          speed: (Math.random() * 0.5 + 0.5) * speed * 3,
        });
      }
      return;
    }

    for (let i = 0; i < count; i++) {
      const r = Math.random() * 2 + 1.2;
      particles.current.push({
        x:     Math.random() * w,
        y:     Math.random() * h,
        vx:    (Math.random() - 0.5) * speed,
        vy:    (Math.random() - 0.5) * speed,
        r,
        alpha: Math.random() * 0.5 + 0.3,
        phase: Math.random() * Math.PI * 2,
        col:   Math.random() > 0.7 ? accentColor : color,
      });
    }
  }, [mode, count, color, accentColor, speed]);

  // ── Main animation loop ────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0;
    let frame = 0;

    const resize = () => {
      w = canvas.width  = canvas.offsetWidth;
      h = canvas.height = canvas.offsetHeight;
      initParticles(w, h);
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement || canvas);

    const onMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    if (interactive) window.addEventListener("mousemove", onMouse, { passive: true });

    // ── Draw functions per mode ─────────────────────────────────────────────
    const drawFloat = () => {
      ctx.clearRect(0, 0, w, h);
      particles.current.forEach(p => {
        p.phase += 0.015;
        const pulse = 0.5 + 0.5 * Math.sin(p.phase);
        const a = p.alpha * (0.4 + 0.6 * pulse);

        if (glowIntensity > 0) {
          ctx.shadowColor = p.col;
          ctx.shadowBlur  = p.r * 6 * glowIntensity;
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.8 + 0.4 * pulse), 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(p.col, a);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Move
        if (interactive) {
          const dx = p.x - mouseRef.current.x;
          const dy = p.y - mouseRef.current.y;
          const dd = Math.sqrt(dx * dx + dy * dy);
          if (dd < 80) {
            p.vx += (dx / dd) * 0.08;
            p.vy += (dy / dd) * 0.08;
          }
        }
        p.vx *= 0.994; p.vy *= 0.994;
        p.x  += p.vx;  p.y  += p.vy;
        if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      });
    };

    const drawNeural = () => {
      ctx.clearRect(0, 0, w, h);
      const ps = particles.current;

      // Connections
      for (let i = 0; i < ps.length; i++) {
        for (let j = i + 1; j < ps.length; j++) {
          const dx = ps[i].x - ps[j].x;
          const dy = ps[i].y - ps[j].y;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < connectionDist) {
            const lineAlpha = (1 - d / connectionDist) * 0.35;
            ctx.beginPath();
            ctx.moveTo(ps[i].x, ps[i].y);
            ctx.lineTo(ps[j].x, ps[j].y);
            ctx.strokeStyle = hexToRgba(color, lineAlpha);
            ctx.lineWidth   = 0.8;
            ctx.stroke();
          }
        }
      }

      // Nodes
      ps.forEach(p => {
        p.phase += 0.012;
        const pulse = 0.6 + 0.4 * Math.sin(p.phase);

        ctx.shadowColor = p.col;
        ctx.shadowBlur  = p.r * 8 * glowIntensity * pulse;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * pulse, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(p.col, p.alpha * pulse);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (interactive) {
          const dx = p.x - mouseRef.current.x;
          const dy = p.y - mouseRef.current.y;
          const dd = Math.sqrt(dx * dx + dy * dy);
          if (dd < 100) { p.vx += (dx / dd) * 0.06; p.vy += (dy / dd) * 0.06; }
        }
        p.vx *= 0.992; p.vy *= 0.992;
        p.x  += p.vx;  p.y  += p.vy;
        if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10;
      });
    };

    const drawGalaxy = () => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      frame += 0.002;

      particles.current.forEach((p, i) => {
        const angle  = (i / particles.current.length) * Math.PI * 2 + frame * (1 + (i % 3) * 0.2);
        const radius = (60 + (i % 5) * 40) * (1 + Math.sin(p.phase + frame) * 0.15);
        p.x = cx + Math.cos(angle) * radius;
        p.y = cy + Math.sin(angle) * radius * 0.4;  // flatten for perspective
        p.phase += 0.008;

        const pulse = 0.5 + 0.5 * Math.sin(p.phase);
        ctx.shadowColor = p.col;
        ctx.shadowBlur  = p.r * 10 * glowIntensity * pulse;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.6 + 0.8 * pulse), 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(p.col, p.alpha * (0.5 + 0.5 * pulse));
        ctx.fill();
        ctx.shadowBlur = 0;
      });
    };

    const drawMatrix = () => {
      // Fade trail
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(0, 0, w, h);

      particles.current.forEach(p => {
        p.y += (p.speed || 1);
        if (p.y > h) { p.y = 0; p.alpha = Math.random() * 0.8 + 0.2; }
        p.phase += 0.1;

        const a = p.alpha * (0.5 + 0.5 * Math.sin(p.phase));
        ctx.shadowColor = p.col;
        ctx.shadowBlur  = 6 * glowIntensity;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba(p.col, a);
        ctx.fill();
        ctx.shadowBlur = 0;
      });
    };

    const draw = {
      float:  drawFloat,
      neural: drawNeural,
      galaxy: drawGalaxy,
      matrix: drawMatrix,
    }[mode];

    const tick = () => {
      draw();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
      if (interactive) window.removeEventListener("mousemove", onMouse);
    };
  }, [mode, color, accentColor, speed, connectionDist, glowIntensity, interactive, initParticles, hexToRgba]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ opacity, zIndex: 0 }}
      aria-hidden="true"
    />
  );
}
