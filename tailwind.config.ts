import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-geist-mono)', 'GeistMono', 'Fira Code', 'monospace'],
        sans: ['var(--font-geist-sans)', 'GeistSans', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Core palette — Bloomberg-dark
        surface: {
          DEFAULT: '#0a0a0a',
          raised: '#111111',
          overlay: '#1a1a1a',
          border: '#222222',
        },
        // Domain colors
        ventures: {
          DEFAULT: '#f59e0b',
          dim: '#78450a',
          bg: '#1c1004',
        },
        career: {
          DEFAULT: '#3b82f6',
          dim: '#1d3a6e',
          bg: '#040d1c',
        },
        wealth: {
          DEFAULT: '#22c55e',
          dim: '#145c2e',
          bg: '#041408',
        },
        body: {
          DEFAULT: '#ef4444',
          dim: '#6b1c1c',
          bg: '#1c0404',
        },
        mind: {
          DEFAULT: '#a855f7',
          dim: '#4a1d7a',
          bg: '#100420',
        },
        // Severity
        info: '#64748b',
        warning: '#f59e0b',
        critical: '#ef4444',
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-in-out',
        'slide-up': 'slideUp 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
