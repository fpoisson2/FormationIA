import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "float-soft": {
          "0%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
          "100%": { transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 700ms ease-out both",
        "fade-in-up-delayed": "fade-in-up 900ms ease-out both",
        "float-soft": "float-soft 6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
