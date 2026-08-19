/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        // Discord-inspired dark palette
        ink: {
          950: '#0a0b0f',
          900: '#0e0f14',
          850: '#121419',
          800: '#1a1c23',
          750: '#23262f',
          700: '#2b2e38',
          600: '#3a3e4a',
          500: '#4a4e5a',
          400: '#6b7080',
          300: '#8b90a0',
          200: '#b5b9c5',
          100: '#d8dae0',
        },
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        accent: {
          green: '#22c55e',
          red: '#ef4444',
          amber: '#f59e0b',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(99, 102, 241, 0.3), 0 0 24px -4px rgba(99, 102, 241, 0.4)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '0.8' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.4s ease-out',
        'scale-in': 'scale-in 0.3s ease-out',
        'pulse-ring': 'pulse-ring 1.5s ease-out infinite',
        'slide-up': 'slide-up 0.5s ease-out',
      },
    },
  },
  plugins: [],
};
