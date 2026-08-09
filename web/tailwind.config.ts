import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        blush: "#ffb0af",
        glass: "rgba(255, 255, 255, 0.12)",
        ink: "#0f0f0f"
      },
      fontFamily: {
        display: ["var(--font-heading)", "Plus Jakarta Sans", "sans-serif"],
        sans: ["var(--font-body)", "Manrope", "sans-serif"]
      },
      borderRadius: {
        pill: "999px"
      },
      boxShadow: {
        glass: "0 24px 70px rgba(0, 0, 0, 0.2)"
      }
    }
  },
  plugins: []
};

export default config;
