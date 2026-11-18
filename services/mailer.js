// services/mailer.js — wysyłka maili z panelu admina
// Strategia: Zoho ZeptoMail EU (primary, darmowy 10k/mies.) → MailerSend (fallback, free 100/mies.)
// API identyczne jak dotychczas: sendMail({to, subject, html, text}) + sendPasswordEmail
const ZEPTO_API_KEY = process.env.ZEPTOMAIL_API_KEY;      // token bez prefixu "Zoho-enczapikey"
const ZEPTO_FROM = process.env.ZEPTOMAIL_FROM_EMAIL || "sekretariat@ceea.org.pl";
const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;

// ── Logo (inline CID) – pobierane raz, cache'owane ──
let logoB64 = null;
async function getLogoBase64() {
  if (logoB64) return logoB64;
  try {
    const res = await fetch("https://panel.ceea.org.pl/images/logo-header-color-black.jpg");
    if (!res.ok) return null;
    logoB64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  } catch {
    logoB64 = null; // bez logo mail i tak się wyśle
  }
  return logoB64;
}
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || "sekretariat@ceea.org.pl";
const FROM_NAME = process.env.MAIL_FROM_NAME || "CEEA Panel";

// ── ZeptoMail / Zoho CPaaS (EU) ──
async function sendViaZepto({ to, toName, subject, html, text }) {
  if (!ZEPTO_API_KEY) throw new Error("Brak ZEPTOMAIL_API_KEY");
  // ⚠️ Centrum danych EU – endpoint MUSI być cpaas.zoho.eu (nie api.zeptomail.com!)
  const res = await fetch("https://cpaas.zoho.eu/v1.1/email", {
    method: "POST",
    headers: {
      Authorization: `Zoho-enczapikey ${ZEPTO_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      from: { address: ZEPTO_FROM, name: FROM_NAME },
      to: [{ email_address: { address: to, name: toName || to } }],
      reply_to: [{ address: ZEPTO_FROM }],
      subject,
      htmlbody: html,
      textbody: text || "",
      ...(logoB64 ? { inline_images: [{ content: logoB64, cid: "ceea-logo", mime_type: "image/jpeg" }] } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ZeptoMail ${res.status}: ${body}`);
  }
}

// ── MailerSend (fallback) ──
async function sendViaMailerSend({ to, toName, subject, html, text }) {
  if (!MAILERSEND_API_KEY) throw new Error("Brak MAILERSEND_API_KEY");
  const res = await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MAILERSEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: FROM_EMAIL, name: FROM_NAME },
      to: [{ email: to, name: toName || to }],
      reply_to: [{ email: FROM_EMAIL }],
      subject,
      html,
      text,
      ...(logoB64
        ? { attachments: [{ content: logoB64, filename: "logo.png", disposition: "inline", id: "ceea-logo" }] }
        : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MailerSend ${res.status}: ${body}`);
  }
}

// ── Główna funkcja: primary → fallback ──
async function sendMail(payload) {
  await getLogoBase64(); // logoB64 używane wewnątrz providerów
  try {
    return await sendViaZepto(payload);
  } catch (e) {
    console.warn(`⚠️ ZeptoMail nie powiódł się (${e.message}) – fallback do MailerSend`);
    return await sendViaMailerSend(payload);
  }
}

// ── Wysyłka przez szablon (treść MIESZKA W services/email/) ──
// WAŻNE: getTemplate eksportuje ./email/index.js (nie ./email/templates!).
// Szablon to OBIEKT z metodami defaults()/render() — nie funkcja.
const { getTemplate } = require("./email");

function sendPasswordEmail(to, password, extra = {}) {
  const tpl = getTemplate("password");
  const d = tpl.defaults({ course: null });
  const rendered = tpl.render({
    subject: d.subject,
    preheader: d.preheader,
    values: { ...d.values, password },
    course: null,
    recipient: {
      firstName: extra.firstName || "",
      lastName: extra.surname || "",
      email: to,
    },
  });
  return sendMail({
    to,
    toName: extra.firstName ? `${extra.firstName} ${extra.surname || ""}`.trim() : undefined,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

// ── Wspólny helper dla maili transakcyjnych ──
// Renderuje szablon systemowy (TRANSACTIONAL_TEMPLATES) i wysyła.
// extraValues → dane dynamiczne doklejane do domyślnych values szablonu.
async function _sendTemplateEmail(templateKey, to, extraValues = {}, extra = {}) {
  const tpl = getTemplate(templateKey);
  const d = tpl.defaults({ course: null });
  const rendered = tpl.render({
    subject: d.subject,
    preheader: d.preheader,
    values: { ...d.values, ...extraValues },
    course: null,
    recipient: {
      firstName: extra.firstName || "",
      lastName: extra.surname || "",
      email: to,
    },
  });
  return sendMail({
    to,
    toName: extra.firstName ? `${extra.firstName} ${extra.surname || ""}`.trim() : undefined,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
}

// Anulowanie przesyłki InPost — zamówienie zostaje opłacone
function sendShipmentCanceledEmail(to, order, extra = {}) {
  return _sendTemplateEmail("shipment_canceled", to, {
    orderNumber: order.order_number || "",
    trackingNumber: order.tracking_number || "",
  }, {
    firstName: order.name || order.first_name || extra.firstName || "",
    surname: order.surname || extra.surname || "",
  });
}

// Anulowanie CAŁEGO zamówienia książek
// wasPaid=true → w treści informacja o zwrocie środków
function sendOrderCanceledEmail(to, order, { wasPaid = false, ...extra } = {}) {
  return _sendTemplateEmail("order_canceled", to, {
    orderNumber: order.order_number || "",
    amountLabel: order.amount != null ? `${Number(order.amount).toFixed(2).replace(".", ",")} zł` : "",
    note: wasPaid
      ? "Zamówienie było opłacone — zwrot środków na konto, z którego dokonano płatności, zaksięgujemy w ciągu kilku dni roboczych. W razie pytań prosimy o kontakt z sekretariatem."
      : "Zamówienie nie zostało opłacone, więc nie pobierzemy żadnych środków. Jeśli to pomyłka, możesz złożyć zamówienie ponownie w księgarni.",
  }, {
    firstName: order.name || order.first_name || extra.firstName || "",
    surname: order.surname || extra.surname || "",
  });
}

// Zamówienie książek oznaczone jako WYSŁANE (osobna akcja „Wysłane" w panelu)
function sendShipmentSentEmail(to, order, extra = {}) {
  const m = String(order.delivery_method || "").toLowerCase();
  const deliveryLabel =
    m.includes("paczkomat") || m.includes("parcel") || m.includes("inpost")
      ? `Paczkomat InPost${order.parcel_locker_code ? ` (${order.parcel_locker_code})` : ""}`
      : m.includes("kurier") || m.includes("courier")
      ? "Kurier InPost"
      : order.delivery_method || "";
  return _sendTemplateEmail("shipment_sent", to, {
    orderNumber: order.order_number || "",
    trackingNumber: order.tracking_number || "",
    deliveryLabel,
    trackingUrl: order.tracking_number
      ? `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(order.tracking_number)}`
      : "",
  }, {
    firstName: order.name || order.first_name || extra.firstName || "",
    surname: order.surname || extra.surname || "",
  });
}

// Usunięcie uczestnika z listy kursu
// wasPaid=true → w treści informacja o zwrocie wpłaty
function sendCourseRemovedEmail(to, { firstName = "", surname = "", courseTitle = "", wasPaid = false } = {}) {
  return _sendTemplateEmail("course_removed", to, {
    courseTitle,
    note: wasPaid
      ? "Twoja wpłata za kurs została zaksięgowana — zwrot środków na konto, z którego dokonano płatności, zaksięgujemy w ciągu kilku dni roboczych. W razie pytań prosimy o kontakt z sekretariatem."
      : "Twoja płatność nie została zaksięgowana, więc nie pobierzemy żadnych środków. Jeśli chcesz wziąć udział w kursie, możesz zapisać się ponownie na stronie.",
  }, { firstName, surname });
}

// Jednorazowy link do ustawienia hasła uczestnika (audyt #7)
function sendPasswordResetEmail(to, { resetLink, firstName = "" } = {}) {
  return _sendTemplateEmail("password_reset", to, { resetLink }, { firstName });
}

// Link konfiguracji 2FA dla administratora (nowe konto lub reset 2FA)
// setupLink = jednorazowy, ważny 24 h; trafia TYLKO mailem do adresata.
function sendAdminSetupEmail(to, { setupLink, firstName = "" } = {}) {
  return _sendTemplateEmail("admin_setup", to, { setupLink }, { firstName });
}

module.exports = {
  sendMail,
  sendPasswordEmail,
  sendPasswordResetEmail,
  sendShipmentCanceledEmail,
  sendShipmentSentEmail,
  sendOrderCanceledEmail,
  sendCourseRemovedEmail,
  sendAdminSetupEmail,
  sendViaZepto,
  sendViaMailerSend,
};