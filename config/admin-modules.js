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
  {
    key: "certyfikaty",
    name: "Certyfikaty",
    path: "/certyfikaty",
    icon: "certificate",
    desc: "Generowanie certifikatów",
  },
  {
    key: "platnosci",
    name: "Płatności",
    path: "/platnosci",
    icon: "payments",
    desc: "Przelewy i statusy płatności",
  },
  {
    key: "faktury",
    name: "Faktury",
    path: "/faktury",
    icon: "invoice",  
    desc: "Osoby, które poprosiły o fakturę VAT"
  },
  {
    key: "administratorzy",
    name: "Administratorzy",
    path: "/admini",
    icon: "admins",  
    desc: "Zarządzanie kontami - Administracja"
  },
  
];
