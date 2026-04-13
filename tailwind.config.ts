import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        sidebar: "#0F172A",
        accent: "#2563EB",
        surface: "#F8FAFC",
      },
    },
  },
  plugins: [],
};

export default config;
