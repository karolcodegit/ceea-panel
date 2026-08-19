// Rejestr modułów panelu admina.
// Nowy moduł = nowy wpis tutaj + route w routes/admin.js + widok w views/
module.exports = [
    {
      key: "kursy",
      name: "Kursy",
      path: "/kursy",
      icon: "academic-cap",
      desc: "Materiały do pobrania i listy uczestników",
    },
    {
      key: "maile",
      name: "Maile",
      path: "/maile",
      icon: "envelope",
      desc: "Wysyłka wiadomości do uczestników kursów",
    },
  ];