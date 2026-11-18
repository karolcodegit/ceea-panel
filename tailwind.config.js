/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './views/**/*.ejs',     // wszystkie widoki (dowolna głębokość)
    './public/js/**/*.js',  // klasy generowane w JS (data-table, widgety)
    './public/**/*.html',
  ],
  theme: {
    extend: {
      colors: {
        ceea: {
          red: '#dc2626',
          dark: '#1a1a1a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
