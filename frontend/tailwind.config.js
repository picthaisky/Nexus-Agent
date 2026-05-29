/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Cyber-Thai status palette
        status: {
          standby:    "#1d83b8", // Ocean blue — IDLE / standby
          processing: "#c2783a", // Orange-brown — actively working
          error:      "#d94d4d", // Crimson — failure
          success:    "#36c987"  // Jade — completion / EXP gained
        },
        cyber: {
          bg:    "#070b14",
          panel: "#0f1626",
          gold:  "#d4af37",
          neon:  "#5fe1ff"
        }
      },
      animation: {
        "pulse-slow":  "pulse 3s cubic-bezier(0.4,0,0.6,1) infinite",
        "pulse-fast":  "pulse 0.8s cubic-bezier(0.4,0,0.6,1) infinite",
        "spin-slow":   "spin 8s linear infinite",
        "spin-fast":   "spin 2s linear infinite",
        "ticker":      "ticker 18s linear infinite",
        "scanline":    "scanline 2.4s linear infinite",
        "exp-popup":   "expPopup 1.4s ease-out forwards"
      },
      keyframes: {
        ticker:   { from: { transform: "translateX(100%)" }, to: { transform: "translateX(-100%)" } },
        scanline: { "0%,100%": { transform: "translateY(-110%)" }, "50%": { transform: "translateY(110%)" } },
        expPopup: { "0%": { opacity: "0", transform: "translateY(0) scale(0.8)" },
                    "20%": { opacity: "1", transform: "translateY(-20px) scale(1.1)" },
                    "100%": { opacity: "0", transform: "translateY(-60px) scale(1)" } }
      }
    }
  },
  plugins: []
};
