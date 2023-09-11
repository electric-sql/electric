/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/toolbar/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [require("tw-elements-react/dist/plugin.cjs")],
}