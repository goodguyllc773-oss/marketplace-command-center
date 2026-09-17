/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        base: {
          950: "#0c0c10",
          900: "#131318",
          800: "#1c1c23",
          700: "#28282f",
          600: "#38383f",
        },
        accent: {
          DEFAULT: "#a78bfa",
          muted: "#6d28d9",
        },
      },
    },
  },
  plugins: [],
};
