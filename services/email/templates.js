// ═══════════════════════════════════════════════════════════════
// services/email/templates.js — definicje szablonów maili panelu
//
// Szablon to OBIEKT:
//   {
//     key, name, description, icon,
//     fields: [{ key, label, type: "text"|"textarea"|"html", rows?, hint? }],
//     defaults({ course })        → { subject, preheader, values },
//     render({ subject, preheader, values, course, recipient })
//                                 → { subject, preheader, html, text }
//   }
//
// TEMPLATES               → widoczne w module „Maile" (wysyłka grupowa)
// TRANSACTIONAL_TEMPLATES → systemowe (hasło, anulowania) — NIE pojawiają
//                           się w module „Maile", wywoływane z kodu panelu.
// ═══════════════════════════════════════════════════════════════

const { renderEmail, infoBox, button, esc } = require("./layout");

const SITE_URL = "https://ceea.org.pl";
const PANEL_URL = process.env.PANEL_URL || "https://panel.ceea.org.pl";

// ── Pomocnicze ──
const nl2br = (v) => esc(v).replace(/\r?\n/g, "<br />");

function greeting(recipient = {}) {
  const name = (recipient.firstName || "").trim();
  return `<p>Dzień dobry${name ? ` ${esc(name)}` : ""},</p>`;
}

const CLOSING = `
  <p style="margin-top:28px">Pozdrawiamy,<br /><strong>Zespół CEEA Poznań</strong></p>`;

// Ramka z danymi (wiersze: [etykieta, wartość]) — np. termin, miejsce, numer.
function detailsBox(rows) {
  return infoBox(`
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${rows
        .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
        .map(
          ([label, value]) => `
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#991b1b;text-transform:uppercase;letter-spacing:1px;font-weight:700;width:40%">${esc(label)}</td>
          <td style="padding:4px 0;font-size:15px;color:#111827;font-weight:600">${esc(value)}</td>
        </tr>`
        )
        .join("")}
    </table>`);
}

// Sekcja z pogrubionym nagłówkiem
function section(title, inner) {
  return `
  <p style="margin:24px 0 8px;font-size:16px;font-weight:700;color:#111827">${esc(title)}</p>
  ${inner}`;
}

// CTA — opakowanie na button() z layoutu (czytelniejsze w szablonach)
function ctaButton(label, url) {
  if (!label || !url) return "";
  return button(label, url);
}

// Tekstowa wersja maila (strip HTML)
function htmlToText(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#847;|&zwnj;/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ═══════════════════════════════════════════════════════════════
// TEMPLATES — widoczne w module „Maile"
// ═══════════════════════════════════════════════════════════════

const TEMPLATES = {
  // ── Zaproszenie na kurs ──
  invite: {
    key: "invite",
    name: "Zaproszenie na kurs",
    description: "Oficjalne zaproszenie z terminem i miejscem kursu oraz przyciskiem do panelu.",
    icon: "✉️",
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      {
        key: "intro",
        label: "Wstęp",
        type: "textarea",
        rows: 3,
        hint: "Akapit powitalny — możesz użyć zmiennych z kursu (podstawiane automatycznie niżej).",
      },
      {
        key: "details",
        label: "Szczegóły / program (opcjonalnie)",
        type: "textarea",
        rows: 4,
        hint: "Każdy wiersz to osobny punkt listy.",
      },
      { key: "ctaLabel", label: "Tekst przycisku", type: "text" },
      { key: "ctaUrl", label: "Adres przycisku", type: "text" },
    ],
    defaults({ course }) {
      const title = course?.title || "kurs CEEA";
      return {
        subject: `Zaproszenie na ${title} — CEEA`,
        preheader: "Zapraszamy do udziału w kursie — szczegóły w środku.",
        values: {
          heading: "Zaproszenie na kurs",
          intro: `serdecznie zapraszamy do udziału w kursie „${title}". Poniżej znajdziesz najważniejsze informacje organizacyjne.`,
          details: "",
          ctaLabel: "Przejdź do panelu uczestnika",
          ctaUrl: PANEL_URL,
        },
      };
    },
    render({ subject, preheader, values, course, recipient }) {
      const details = String(values.details || "").trim();
      const content = [
        greeting(recipient),
        `<p>${nl2br(values.intro)}</p>`,
        detailsBox([
          ["Kurs", course?.title],
          ["Termin", course?.dateLabel],
          ["Miejsce", course?.location],
        ]),
        details
          ? section(
              "Szczegóły",
              `<ul style="margin:0 0 16px;padding-left:22px">${details
                .split(/\r?\n/)
                .filter((l) => l.trim())
                .map(
                  (l) =>
                    `<li style="font-size:15px;color:#374151;margin-bottom:6px">${esc(l.trim())}</li>`
                )
                .join("")}</ul>`
            )
          : "",
        ctaButton(values.ctaLabel, values.ctaUrl),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },

  // ── Informacje organizacyjne (logistyka) ──
  logistics: {
    key: "logistics",
    name: "Informacje organizacyjne",
    description: "Logistyka przed kursem: dojazd, godziny, sala, parking, obiady.",
    icon: "🧭",
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      { key: "intro", label: "Wstęp", type: "textarea", rows: 3 },
      {
        key: "schedule",
        label: "Godziny / plan dnia",
        type: "textarea",
        rows: 4,
        hint: "Każdy wiersz to osobny punkt listy.",
      },
      {
        key: "arrival",
        label: "Dojazd i lokalizacja",
        type: "textarea",
        rows: 3,
      },
      {
        key: "notes",
        label: "Dodatkowe uwagi (opcjonalnie)",
        type: "textarea",
        rows: 3,
      },
      { key: "ctaLabel", label: "Tekst przycisku", type: "text" },
      { key: "ctaUrl", label: "Adres przycisku", type: "text" },
    ],
    defaults({ course }) {
      const title = course?.title || "kurs CEEA";
      return {
        subject: `Informacje organizacyjne — ${title}`,
        preheader: "Dojazd, godziny i praktyczne wskazówki przed kursem.",
        values: {
          heading: "Informacje organizacyjne",
          intro: `zbliża się kurs „${title}". Poniżej zebraliśmy najważniejsze informacje organizacyjne — prosimy o zapoznanie się z nimi przed przyjazdem.`,
          schedule:
            "Rejestracja uczestników: 8:15–8:45\nRozpoczęcie kursu: 9:00\nZakończenie (orientacyjnie): 17:00",
          arrival:
            course?.location
              ? `Miejsce szkolenia: ${course.location}.`
              : "Miejsce szkolenia podajemy w panelu uczestnika i na stronie kursu.",
          notes: "",
          ctaLabel: "Sprawdź w panelu uczestnika",
          ctaUrl: PANEL_URL,
        },
      };
    },
    render({ subject, preheader, values, course, recipient }) {
      const list = (v) =>
        String(v || "")
          .split(/\r?\n/)
          .filter((l) => l.trim())
          .map(
            (l) =>
              `<li style="font-size:15px;color:#374151;margin-bottom:6px">${esc(l.trim())}</li>`
          )
          .join("");
      const schedule = list(values.schedule);
      const notes = String(values.notes || "").trim();

      const content = [
        greeting(recipient),
        `<p>${nl2br(values.intro)}</p>`,
        detailsBox([
          ["Kurs", course?.title],
          ["Termin", course?.dateLabel],
          ["Miejsce", course?.location],
        ]),
        schedule
          ? section("Plan dnia", `<ul style="margin:0 0 16px;padding-left:22px">${schedule}</ul>`)
          : "",
        String(values.arrival || "").trim()
          ? section("Dojazd i lokalizacja", `<p>${nl2br(values.arrival)}</p>`)
          : "",
        notes ? section("Dodatkowe uwagi", `<p>${nl2br(notes)}</p>`) : "",
        ctaButton(values.ctaLabel, values.ctaUrl),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },

  // ── Materiały szkoleniowe ──
  materials: {
    key: "materials",
    name: "Materiały szkoleniowe",
    description: "Wysyłka linków do materiałów przed/po kursie.",
    icon: "📚",
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      { key: "intro", label: "Wstęp", type: "textarea", rows: 3 },
      {
        key: "materialsList",
        label: "Lista materiałów",
        type: "textarea",
        rows: 4,
        hint: "Każdy wiersz to osobna pozycja listy.",
      },
      { key: "ctaLabel", label: "Tekst przycisku", type: "text" },
      { key: "ctaUrl", label: "Adres przycisku", type: "text" },
    ],
    defaults({ course }) {
      const title = course?.title || "kursu CEEA";
      return {
        subject: `Materiały szkoleniowe — ${title}`,
        preheader: "Udostępniliśmy materiały do kursu — zobacz, co przygotowaliśmy.",
        values: {
          heading: "Materiały szkoleniowe",
          intro: `udostępniliśmy materiały szkoleniowe do kursu „${title}". Znajdziesz je w panelu uczestnika po zalogowaniu.`,
          materialsList:
            "Skrypty i prezentacje z wykładów\nWytyczne i algorytmy postępowania\nMateriały uzupełniające",
          ctaLabel: "Otwórz materiały w panelu",
          ctaUrl: `${PANEL_URL}/materialy`,
        },
      };
    },
    render({ subject, preheader, values, course, recipient }) {
      const items = String(values.materialsList || "")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map(
          (l) =>
            `<li style="font-size:15px;color:#374151;margin-bottom:6px">${esc(l.trim())}</li>`
        )
        .join("");

      const content = [
        greeting(recipient),
        `<p>${nl2br(values.intro)}</p>`,
        course?.title
          ? detailsBox([["Kurs", course.title], ["Termin", course.dateLabel]])
          : "",
        items
          ? section("Dostępne materiały", `<ul style="margin:0 0 16px;padding-left:22px">${items}</ul>`)
          : "",
        ctaButton(values.ctaLabel, values.ctaUrl),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },

  // ── Własna treść (edytor Quill w panelu) ──
  custom: {
    key: "custom",
    name: "Własna treść",
    description: "Dowolna wiadomość — treść formatujesz edytorem w panelu.",
    icon: "✏️",
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      {
        key: "body",
        label: "Treść wiadomości",
        type: "html",
        hint: "Formatowanie: pogrubienie, kursywa, listy, linki.",
      },
    ],
    defaults() {
      return {
        subject: "Wiadomość od CEEA Poznań",
        preheader: "",
        values: {
          heading: "",
          body: "",
        },
      };
    },
    render({ subject, preheader, values, course, recipient }) {
      // body to HTML z edytora Quill — celowo NIE escapujemy
      const content = [
        greeting(recipient),
        String(values.body || ""),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },
};

// ═══════════════════════════════════════════════════════════════
// TRANSACTIONAL_TEMPLATES — systemowe, NIE widoczne w module „Maile"
// Wywoływane z kodu (mailer.js): dane dynamiczne doklejane do values.
// ═══════════════════════════════════════════════════════════════

const TRANSACTIONAL_TEMPLATES = {
  // ── Hasło do panelu (generowane / reset) ──
  password: {
    key: "password",
    name: "Hasło do panelu",
    description: "Systemowy mail z wygenerowanym hasłem do panelu uczestnika.",
    icon: "🔑",
    transactional: true,
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      { key: "intro", label: "Wstęp", type: "textarea", rows: 3 },
      { key: "note", label: "Uwaga pod hasłem", type: "textarea", rows: 2 },
    ],
    defaults() {
      return {
        subject: "Twoje hasło do panelu CEEA",
        preheader: "Wygenerowaliśmy dla Ciebie hasło do panelu uczestnika.",
        values: {
          heading: "Twoje hasło do logowania",
          intro:
            "poniżej znajdziesz wygenerowane hasło do logowania w panelu uczestnika. Zaloguj się tym samym adresem e-mail, na który otrzymałeś tę wiadomość.",
          note:
            "Hasło możesz w każdej chwili zmienić — po zalogowaniu przejdź do zakładki Profil i kliknij „Wyślij nowe hasło”.",
        },
      };
    },
    render({ subject, preheader, values, recipient }) {
      const passwordBox = infoBox(`
        <p style="margin:0 0 6px;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#991b1b;font-weight:700">Twoje hasło</p>
        <p style="margin:0;font-size:26px;font-weight:700;font-family:'Courier New',Courier,monospace;letter-spacing:2px;color:#111827">${esc(values.password)}</p>
      `);

      const content = [
        greeting(recipient),
        `<p>${nl2br(values.intro)}</p>`,
        passwordBox,
        values.note ? `<p>${nl2br(values.note)}</p>` : "",
        ctaButton("Zaloguj się do panelu", PANEL_URL),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },

  // ── Anulowanie przesyłki InPost (zamówienie książek) ──
  shipment_canceled: {
    key: "shipment_canceled",
    name: "Anulowanie przesyłki",
    description: "Systemowy mail po anulowaniu przesyłki InPost w panelu.",
    icon: "📦",
    transactional: true,
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      { key: "intro", label: "Wstęp", type: "textarea", rows: 3 },
      { key: "note", label: "Uwaga (opcjonalnie)", type: "textarea", rows: 2 },
    ],
    defaults() {
      return {
        subject: "Twoja przesyłka została anulowana — CEEA",
        preheader: "Anulowaliśmy przesyłkę z Twojego zamówienia.",
        values: {
          heading: "Przesyłka anulowana",
          intro:
            "informujemy, że przesyłka powiązana z Twoim zamówieniem została anulowana. Twoje zamówienie pozostaje opłacone i nie tracisz żadnych książek — przygotujemy nową przesyłkę.",
          note:
            "Jeśli nie spodziewałeś/aś się tej wiadomości albo masz pytania, odpisz na tego maila lub zadzwoń do sekretariatu.",
        },
      };
    },
    render({ subject, preheader, values, recipient }) {
      const content = [
        greeting(recipient),
        `<p>${nl2br(values.intro)}</p>`,
        detailsBox([
          ["Zamówienie", values.orderNumber],
          ["Numer przesyłki", values.trackingNumber],
        ]),
        values.note ? `<p>${nl2br(values.note)}</p>` : "",
        ctaButton("Twoje zamówienia", `${PANEL_URL}/ksiazki`),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },

  // ── Anulowanie zamówienia książek ──
  order_canceled: {
    key: "order_canceled",
    name: "Anulowanie zamówienia",
    description: "Systemowy mail po anulowaniu całego zamówienia książek.",
    icon: "🛑",
    transactional: true,
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      { key: "intro", label: "Wstęp", type: "textarea", rows: 3 },
      { key: "note", label: "Uwaga o zwrocie", type: "textarea", rows: 2 },
    ],
    defaults() {
      return {
        subject: "Twoje zamówienie zostało anulowane — CEEA",
        preheader: "Anulowaliśmy Twoje zamówienie w księgarni CEEA.",
        values: {
          heading: "Zamówienie anulowane",
          intro:
            "informujemy, że Twoje zamówienie w księgarni CEEA zostało anulowane.",
          note: "", // uzupełnia mailer: wariant ze zwrotem / bez zwrotu
        },
      };
    },
    render({ subject, preheader, values, recipient }) {
      const content = [
        greeting(recipient),
        `<p>${nl2br(values.intro)}</p>`,
        detailsBox([
          ["Zamówienie", values.orderNumber],
          ["Kwota", values.amountLabel],
        ]),
        values.note ? `<p>${nl2br(values.note)}</p>` : "",
        ctaButton("Odwiedź księgarnię", `${SITE_URL}/ksiazki`),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },

  // ── Zamówienie książek WYSŁANE (osobna akcja w panelu) ──
  shipment_sent: {
    key: "shipment_sent",
    name: "Wysyłka zamówienia",
    description: "Systemowy mail po oznaczeniu zamówienia książek jako wysłane.",
    icon: "🚚",
    transactional: true,
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      { key: "intro", label: "Wstęp", type: "textarea", rows: 3 },
      { key: "note", label: "Uwaga o panelu", type: "textarea", rows: 3 },
    ],
    defaults() {
      return {
        subject: "Twoja paczka jest w drodze — CEEA",
        preheader: "Wysłaliśmy Twoje zamówienie — sprawdź, gdzie jest paczka.",
        values: {
          heading: "Paczka wysłana",
          intro:
            "dziękujemy za zakupy w księgarni CEEA. Twoje zamówienie zostało właśnie wysłane.",
          note:
            "Status przesyłki możesz na bieżąco sprawdzić w panelu uczestnika — zaloguj się tym samym adresem e-mail, którego użyłeś przy zamówieniu. Jeśli nie masz jeszcze hasła, na stronie logowania kliknij „Wyślij nowe hasło”.",
        },
      };
    },
    render({ subject, preheader, values, recipient }) {
      // trackingUrl wstrzykuje mailer; bez numeru śledzenia → panel uczestnika
      const ctaLabel = values.trackingUrl ? "Śledź przesyłkę" : "Twoje zamówienia";
      const ctaUrl = values.trackingUrl || `${PANEL_URL}/ksiazki`;

      const content = [
        greeting(recipient),
        `<p>${nl2br(values.intro)}</p>`,
        detailsBox([
          ["Zamówienie", values.orderNumber],
          ["Dostawa", values.deliveryLabel],
          ["Numer śledzenia", values.trackingNumber],
        ]),
        values.note ? `<p>${nl2br(values.note)}</p>` : "",
        ctaButton(ctaLabel, ctaUrl),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },

  // ── Usunięcie uczestnika z kursu ──
  course_removed: {
    key: "course_removed",
    name: "Usunięcie z listy uczestników",
    description: "Systemowy mail po usunięciu uczestnika z listy kursu (panel → Płatności).",
    icon: "👋",
    transactional: true,
    fields: [
      { key: "heading", label: "Nagłówek", type: "text" },
      { key: "intro", label: "Wstęp", type: "textarea", rows: 3 },
      { key: "note", label: "Uwaga (opcjonalnie)", type: "textarea", rows: 2 },
    ],
    defaults() {
      return {
        subject: "Twoje zgłoszenie na kurs zostało anulowane — CEEA",
        preheader: "Usunęliśmy Twoje zgłoszenie z listy uczestników kursu.",
        values: {
          heading: "Zgłoszenie anulowane",
          intro:
            "informujemy, że Twoje zgłoszenie zostało usunięte z listy uczestników kursu.",
          note: "", // uzupełnia mailer: wariant ze zwrotem / bez zwrotu
        },
      };
    },
    render({ subject, preheader, values, recipient }) {
      const content = [
        greeting(recipient),
        `<p>${nl2br(values.intro)}</p>`,
        detailsBox([["Kurs", values.courseTitle]]),
        values.note ? `<p>${nl2br(values.note)}</p>` : "",
        ctaButton("Zobacz inne kursy", `${SITE_URL}/kursy`),
        CLOSING,
      ].join("\n");

      const { html } = renderEmail({
        preheader,
        title: values.heading,
        content,
      });
      return { subject, preheader, html, text: htmlToText(html) };
    },
  },
};

module.exports = { TEMPLATES, TRANSACTIONAL_TEMPLATES };