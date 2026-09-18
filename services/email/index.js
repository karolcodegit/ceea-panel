const wrap = require("./layout");
const invitation = require("./bodies/invitation");
// const payment = require("./bodies/payment");
const logistics = require("./bodies/logistics");
const custom = require("./bodies/custom");

// ── Konwersja HTML → plain text (obniża spam score) ──
function htmlToText(html) {
  let text = html
    .replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, url, inner) => {
      const clean = inner.replace(/<[^>]+>/g, "").trim();
      return clean ? `${clean} (${url})` : url;
    })
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, "\n\n$1\n\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "• $1\n")
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(b|strong)>/gi, "**")
    .replace(/<\/?(i|em)>/gi, "_")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const year = new Date().getFullYear();
  text += `\n\n--\n`;
  text += `Europejska Fundacja ds. Szkolenia w Anestezjologii\n`;
  text += `ul. Sokolnicka 56, 62-021 Paczkowo\n`;
  text += `NIP: 777-314-61-00 | REGON: 301341024 | KRS: 0000347155\n`;
  text += `© ${year} CEEA Poznań. Wszelkie prawa zastrzeżone.\n`;
  text += `W razie pytań: sekretariat@ceea.org.pl | tel. 61 869 13 57`;

  return text;
}

const templates = {
  invitation: {
    body: invitation,
    defaultSubject: ({ courseTitle }) => `Zaproszenie na kurs ${courseTitle}`,
    defaultPreheader: ({ courseTitle }) => `Zaproszenie na kurs ${courseTitle} – CEEA Poznań`,
  },
  // payment_reminder: {
  //   body: payment,
  //   defaultSubject: ({ courseTitle }) => `Przypomnienie o płatności – ${courseTitle}`,
  //   defaultPreheader: ({ courseTitle }) => `Prosimy o uregulowanie wpisowego na kurs ${courseTitle}`,
  // },
  logistics: {
    body: logistics,
    defaultSubject: ({ courseTitle }) => `Szczegóły kursu ${courseTitle}`,
    defaultPreheader: ({ courseTitle }) => `Miejsce, godziny i program kursu ${courseTitle}`,
  },
  custom: {
    body: custom,
    defaultSubject: () => "",
    defaultPreheader: () => "",
  },
};

function renderTemplate(key, data, customBodyHtml = null) {
  const tpl = templates[key];
  if (!tpl) throw new Error(`Nieznany szablon: ${key}`);

  // Dla "custom" bierzemy treść z edytora, dla reszty predefiniowaną
  const bodyContent = key === "custom" ? (customBodyHtml || "") : tpl.body(data);
  const subject = data.subject || tpl.defaultSubject(data);
  const preheader = data.preheader || tpl.defaultPreheader(data);

  return {
    subject,
    preheader,
    html: wrap(bodyContent, preheader),
    text: htmlToText(bodyContent),
    bodyContent, // surowe body (przydatne do edytora)
  };
}

// Zwraca domyślne wartości szablonu (do wypełnienia edytora)
function getTemplateDefaults(key, data) {
  const tpl = templates[key];
  if (!tpl) return null;
  return {
    subject: tpl.defaultSubject(data),
    preheader: tpl.defaultPreheader(data),
    bodyHtml: key === "custom" ? "" : tpl.body(data),
  };
}

module.exports = { renderTemplate, getTemplateDefaults, htmlToText, templates };