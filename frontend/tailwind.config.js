import typography from '@tailwindcss/typography'

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        sidebar: { DEFAULT: '#26333D', panel: '#2F3E49' },
        accent: { DEFAULT: '#3DA94B', hover: '#2E8F3B' },
        'app-bg': '#F5F7F8',
        line: '#E5EAEC',
        ink: '#1D2831',
        muted: '#6C7781',
        faint: '#8B969D',
        danger: { DEFAULT: '#C0392B', bg: '#FBEAE8' },
        warn: { DEFAULT: '#B4791A', bg: '#FBF2E1' },
        ok: { bg: '#EAF6EC' },
        info: { DEFAULT: '#3161B4', bg: '#ECF2FB' },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      keyframes: {
        stamp: {
          '0%': { transform: 'scale(1.35) rotate(-5deg)', opacity: '0' },
          '60%': { transform: 'scale(0.97) rotate(1deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(0deg)', opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'none' },
        },
      },
      animation: {
        stamp: 'stamp 280ms ease-out',
        'fade-up': 'fade-up 300ms ease both',
      },
    },
  },
  plugins: [typography],
}
