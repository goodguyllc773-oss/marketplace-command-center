/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0a0e14",
          900: "#0f141c",
          800: "#161c26",
          700: "#1f2733",
          600: "#2a3444",
        },
        accent: {
          DEFAULT: "#22d3ee",
          muted: "#0e7490",
        },
      },
    },
  },
  plugins: [],
};
