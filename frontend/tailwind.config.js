/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        felt: { DEFAULT: '#2B3B32', dark: '#141C18' },
        parchment: { DEFAULT: '#F1EADD', dark: '#211D17' },
        ink: '#1B1B16',
        brass: '#B8863B',
        oxblood: { DEFAULT: '#8B3A3A', dark: '#C4605C' },
        rule: { DEFAULT: '#C9BFA8', dark: '#3A362C' },
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        body: ['"Work Sans"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      keyframes: {
        stamp: {
          '0%': { transform: 'scale(1.35) rotate(-5deg)', opacity: '0' },
          '60%': { transform: 'scale(0.97) rotate(1deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
      },
      animation: {
        stamp: 'stamp 280ms ease-out',
      },
    },
  },
  plugins: [],
}
