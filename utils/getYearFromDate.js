const getYearFromDate = (date) => {
    if (!date) return 'brak-roku'; // Dla kursów bez daty
    const dateParts = date.split('.');
    if (dateParts.length > 1) {
      return dateParts[2].slice(-4); // Dla dat w formacie np. "8-10.05.2025"
    }
    return date.length === 4 ? date : 'brak-roku'; // Dla kursów z rokiem np. "2025"
  };


module.exports = { getYearFromDate }