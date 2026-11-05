// ═══════════════════════════════════════════════════════════════
// services/email/templates.js — 3 szablony maili panelu
//
// Zasada: wspólny LAYOUT pochodzi z ./layout (renderEmail: logo,
// karta, stopka). Szablon buduje WYŁĄCZNIE "content" maila.
//
// Szablon = {
//   key, name, description, icon,
//   fields: [ { key, label, type: 'text'|'textarea'|'html', rows?, hint? } ],
//   defaults({ course }) → { subject, preheader, values: { <fieldKey>: string } },
//   render({ subject, preheader, values, course, recipient }) → { subject, preheader, html, text }
// }
//
// course    = { id, title, location, dateLabel } | null  (z Supabase)
// recipient = { firstName, lastName, email }              (personalizacja)
// ═══════════════════════════════════════════════════════════════

const { renderEmail, infoBox, button, esc } = require("./layout");

const SITE_URL = "https://ceea.org.pl";
const PANEL_URL = process.env.PANEL_URL || "https://panel.ceea.org.pl";

// ── Pomocnicze ──

// textarea → bezpieczny HTML: escapowanie + nowe linie jako <br />
const nl2br = (v) => esc(v ?? "").replace(/\r?\n/g, "<br />");

const greeting = (firstName) =>
  `<p>Dzień dobry${firstName ? ` ${esc(firstName)}` : ""},</p>`;

const CLOSING = `<p>Pozdrawiamy,<br /><strong>Zespół CEEA Poznań</strong></p>`;

// Ramka ze szczegółami (puste wartości są pomijane)
const detailsBox = (rows) => {
  const visible = rows.filter(([, v]) => v && String(v).trim() !== "");
  if (!visible.length) return "";
  return infoBox(`
    <table role="presentation" cellpadding="0" cellspacing="0">
      ${visible
        .map(
          ([label, value]) => `
      <tr>
        <td style="padding:3px 14px 3px 0;font-size:14px;color:#6b7280;white-space:nowrap;vertical-align:top">${esc(
          label
        )}:</td>
        <td style="padding:3px 0;font-size:14.5px;color:#111827;vertical-align:top"><strong>${esc(
          value
        )}</strong></td>
      </tr>`
        )
        .join("")}
    </table>`);
};

// Sekcja z nagłówkiem — renderowana tylko gdy ma treść
const section = (label, html) =>
  html && html.trim() !== ""
    ? `<p style="margin:20px 0 6px"><strong>${esc(label)}</strong></p><p>${html}</p>`
    : "";

const ctaButton = (label, url) => (label && url ? button(label, url) : "");

// prosty strip HTML dla wersji tekstowej
const htmlToText = (html) =>
  String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<li>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// ═══════════════════════════════════════════════════════════════
// SZABLONY
// ═══════════════════════════════════════════════════════════════

const TEMPLATES = {
  // ── 1. Zaproszenie na kurs ──
  invite: {
    key: "invite",
    name: "Zaproszenie na kurs",
    description: "Oficjalne zaproszenie z ramką szczegółów kursu",
    icon: "📩",
    fields: [
      { key: "heading", label: "Nagłówek w treści maila", type: "text" },
      { key: "intro", label: "Treść wstępu", type: "textarea", rows: 5 },
      {
        key: "courseDate",
        label: "Termin kursu",
        type: "text",
        hint: "Pobrany z Supabase — możesz zmienić",
      },
      { key: "courseLocation", label: "Miejsce kursu", type: "text" },
      { key: "buttonLabel", label: "Tekst przycisku", type: "text" },
      { key: "buttonUrl", label: "Link przycisku", type: "text" },
    ],
    defaults({ course }) {
      const title = course?.title || "Kurs CEEA";
      return {
        subject: `Zaproszenie na kurs: ${title}`,
        preheader: `${title} — zapisy otwarte`,
        values: {
          heading: "Zaproszenie na kurs",
          intro:
            `Serdecznie zapraszamy na kurs „${title}” organizowany przez Europejską Fundację ds. Szkolenia w Anestezjologii.\n` +
            `Zapisy są już otwarte, a liczba miejsc jest ograniczona — zachęcamy do wcześniejszej rejestracji.`,
          courseDate: course?.dateLabel || "",
          courseLocation: course?.location || "Hotel Ilonn, Poznań",
          buttonLabel: "Zapisz się na kurs",
          buttonUrl: `${SITE_URL}/kursy`,
        },
      };
    },
    render({ subject, preheader, values, course, recipient }) {
      const title = course?.title || "Kurs CEEA";
      const content = `
        ${greeting(recipient.firstName)}
        <p>${nl2br(values.intro)}</p>
        ${detailsBox([
          ["Kurs", title],
          ["Termin", values.courseDate],
          ["Miejsce", values.courseLocation],
        ])}
        <p>Szczegółowy program kursu oraz formularz zgłoszeniowy znajdziesz na naszej stronie.</p>
        ${ctaButton(values.buttonLabel, values.buttonUrl)}
        ${CLOSING}`;

      const text = [
        `Dzień dobry${recipient.firstName ? " " + recipient.firstName : ""},`,
        "",
        values.intro || "",
        "",
        `Kurs: ${title}`,
        values.courseDate ? `Termin: ${values.courseDate}` : null,
        values.courseLocation ? `Miejsce: ${values.courseLocation}` : null,
        "",
        "Szczegółowy program kursu oraz formularz zgłoszeniowy znajdziesz na naszej stronie.",
        values.buttonUrl
          ? `${values.buttonLabel || "Zobacz więcej"}: ${values.buttonUrl}`
          : null,
        "",
        "Pozdrawiamy,",
        "Zespół CEEA Poznań",
      ]
        .filter((l) => l !== null)
        .join("\n");

      return {
        subject,
        preheader,
        html: renderEmail({
          preheader,
          title: values.heading || "",
          content,
        }).html,
        text,
      };
    },
  },

  // ── 2. Informacje logistyczne ──
  logistics: {
    key: "logistics",
    name: "Informacje logistyczne",
    description: "Miejsce, data, program — dla zapisanych uczestników",
    icon: "📍",
    fields: [
      { key: "heading", label: "Nagłówek w treści maila", type: "text" },
      { key: "intro", label: "Treść wstępu", type: "textarea", rows: 4 },
      {
        key: "courseDate",
        label: "Termin kursu",
        type: "text",
        hint: "Pobrany z Supabase — możesz zmienić",
      },
      { key: "courseLocation", label: "Miejsce kursu", type: "text" },
      {
        key: "program",
        label: "Program / plan dnia",
        type: "textarea",
        rows: 4,
        hint: "Opcjonalnie — puste pole zostanie pominięte w mailu",
      },
      {
        key: "extra",
        label: "Dodatkowe informacje",
        type: "textarea",
        rows: 3,
        hint: "np. parking, wyżywienie, materiały — puste pole zostanie pominięte",
      },
      { key: "buttonLabel", label: "Tekst przycisku", type: "text" },
      { key: "buttonUrl", label: "Link przycisku", type: "text" },
    ],
    defaults({ course }) {
      const title = course?.title || "Kurs CEEA";
      return {
        subject: `Informacje logistyczne: ${title}`,
        preheader: `Termin, miejsce i program kursu ${title}`,
        values: {
          heading: "Informacje logistyczne",
          intro:
            `dziękujemy za zapisanie się na kurs „${title}”. ` +
            `Poniżej przesyłamy najważniejsze informacje organizacyjne przed kursem.`,
          courseDate: course?.dateLabel || "",
          courseLocation: course?.location || "Hotel Ilonn, Poznań",
          program: "",
          extra: "",
          buttonLabel: "Panel uczestnika",
          buttonUrl: PANEL_URL,
        },
      };
    },
    render({ subject, preheader, values, course, recipient }) {
      const title = course?.title || "Kurs CEEA";
      const content = `
        ${greeting(recipient.firstName)}
        <p>${nl2br(values.intro)}</p>
        ${detailsBox([
          ["Kurs", title],
          ["Termin", values.courseDate],
          ["Miejsce", values.courseLocation],
        ])}
        ${section("Program", nl2br(values.program))}
        ${section("Dodatkowe informacje", nl2br(values.extra))}
        <p>W razie pytań pozostajemy do dyspozycji — wystarczy odpowiedzieć na tego maila.</p>
        ${ctaButton(values.buttonLabel, values.buttonUrl)}
        ${CLOSING}`;

      const text = [
        `Dzień dobry${recipient.firstName ? " " + recipient.firstName : ""},`,
        "",
        values.intro || "",
        "",
        `Kurs: ${title}`,
        values.courseDate ? `Termin: ${values.courseDate}` : null,
        values.courseLocation ? `Miejsce: ${values.courseLocation}` : null,
        values.program ? `\nProgram:\n${values.program}` : null,
        values.extra ? `\nDodatkowe informacje:\n${values.extra}` : null,
        "",
        "W razie pytań pozostajemy do dyspozycji — wystarczy odpowiedzieć na tego maila.",
        values.buttonUrl
          ? `${values.buttonLabel || "Zobacz więcej"}: ${values.buttonUrl}`
          : null,
        "",
        "Pozdrawiamy,",
        "Zespół CEEA Poznań",
      ]
        .filter((l) => l !== null)
        .join("\n");

      return {
        subject,
        preheader,
        html: renderEmail({
          preheader,
          title: values.heading || "",
          content,
        }).html,
        text,
      };
    },
  },

  // ── 3. Własna treść ──
  custom: {
    key: "custom",
    name: "Własna treść",
    description: "Pełna dowolność z edytorem",
    icon: "✏️",
    fields: [
      {
        key: "heading",
        label: "Nagłówek w treści maila",
        type: "text",
        hint: "Zostaw puste, żeby ukryć nagłówek",
      },
      {
        key: "content",
        label: "Treść maila",
        type: "html",
        hint: "Edytor tekstu sformatowanego — pogrubienia, listy, linki",
      },
    ],
    defaults() {
      return {
        subject: "Wiadomość od CEEA Poznań",
        preheader: "",
        values: {
          heading: "",
          content: "",
        },
      };
    },
    render({ subject, preheader, values, recipient }) {
      const body =
        values.content && values.content.replace(/<[^>]+>/g, "").trim() !== ""
          ? values.content
          : "<p>(pusta treść)</p>";

      const content = `
        ${greeting(recipient.firstName)}
        ${body}
        ${CLOSING}`;

      const text = [
        `Dzień dobry${recipient.firstName ? " " + recipient.firstName : ""},`,
        "",
        htmlToText(values.content),
        "",
        "Pozdrawiamy,",
        "Zespół CEEA Poznań",
      ].join("\n");

      return {
        subject,
        preheader,
        html: renderEmail({
          preheader,
          title: values.heading || "",
          content,
        }).html,
        text,
      };
    },
  },
};

module.exports = { TEMPLATES };