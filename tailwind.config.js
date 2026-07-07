/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
   './views/**/*.ejs',      // views/*.ejs i views/*/*.ejs
    './views/**/**/*.ejs',   // views/*/*/*.ejs (głębsze foldery)
    './public/**/*.html',
    './views/*.ejs',
  ],
  theme: {
    extend: {
      colors: {
        ceea: {
          red: '#dc2626',
          dark: '#1a1a1a',
        }
      }
    },
  },
  plugins: [],
}