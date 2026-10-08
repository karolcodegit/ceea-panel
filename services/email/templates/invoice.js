// services/email/templates/invoice.js — maile fakturowe (PDF wystawiona / KSeF)
const { renderEmail, button, money } = require("../layout");

const issued = function invoiceIssuedTemplate({ firstName, invoiceNumber, amount, courseTitle, pdfUrl }) {
  const { html } = renderEmail({
    preheader: `Faktura ${invoiceNumber} za kurs "${courseTitle}"`,
    title: `Dzień dobry ${firstName || ""},`.trim(),
    content: `
      <p>wystawiliśmy fakturę <strong>${invoiceNumber}</strong> na kwotę <strong>${money(amount)}</strong>
         za udział w kursie <strong>"${courseTitle}"</strong>.</p>
      ${pdfUrl ? button("Pobierz fakturę PDF", pdfUrl) : ""}
      <p style="font-size:13px;color:#6b7280">Faktura zostanie również przesłana do KSeF –
         poinformujemy Cię w osobnej wiadomości.</p>
    `,
  });

  return {
    subject: `Faktura ${invoiceNumber} – kurs "${courseTitle}" – CEEA Poznań`,
    html,
    text: `Dzień dobry ${firstName || ""},\n\nwystawiliśmy fakturę ${invoiceNumber} na ${money(amount)} za kurs "${courseTitle}".`,
  };
};

const ksef = function invoiceKsefTemplate({ firstName, invoiceNumber, courseTitle, ksefNumber }) {
  const { html } = renderEmail({
    preheader: `Faktura ${invoiceNumber} została przekazana do KSeF`,
    title: `Dzień dobry ${firstName || ""},`.trim(),
    content: `
      <p>faktura <strong>${invoiceNumber}</strong> za kurs <strong>"${courseTitle}"</strong> została
         przekazana do Krajowego Systemu e-Faktur.</p>
      ${ksefNumber ? `<p>Numer KSeF: <strong>${ksefNumber}</strong></p>` : ""}
      <p>Fakturę znajdziesz również w swoim panelu kursanta.</p>
    `,
    footerNote: "Faktura ustrukturyzowana KSeF – dokument w panelu ma charakter informacyjny.",
  });

  return {
    subject: `Faktura w KSeF – ${invoiceNumber} – CEEA Poznań`,
    html,
    text: `Dzień dobry ${firstName || ""},\n\nfaktura ${invoiceNumber} za kurs "${courseTitle}" została przekazana do KSeF.`,
  };
};

module.exports = { issued, ksef };
