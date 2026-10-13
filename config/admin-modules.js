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
    key: "ksiazki",
    name: "Książki",
    path: "/ksiazki",
    icon: "books",
    desc: "Ksiązki do wyświtlenia i edycji",
  },
  {
    key: "pracownicy",
    name: "Pracownicy",
    path: "/pracownicy",
    icon: "employees",
    desc: "Pracownicy zarządzający organizacją",
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
    key: "sponsorzy",
    name: "Sponsorzy",
    path: "/sponsorzy",
    icon: "sponsors",
    desc: "Lista wszystkich sponsorów"
  },
  {
    key: "faq",
    name: "Faq",
    path: "/faq",
    icon: "faq",
    desc: "Lista wszystkich popularnych pytań"
  },
  {
    key: "administratorzy",
    name: "Administratorzy",
    path: "/admini",
    icon: "admins",
    desc: "Zarządzanie kontami - Administracja"
  },
  
];
