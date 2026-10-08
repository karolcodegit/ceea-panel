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
async function sendViaZepto({ to, subject, html, text }) {
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
      to: [{ email_address: { address: to, name: to } }],
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
async function sendViaMailerSend({ to, subject, html, text }) {
  if (!MAILERSEND_API_KEY) throw new Error("Brak MAILERSEND_API_KEY");
  const res = await fetch("https://api.mailersend.com/v1/email", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MAILERSEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: FROM_EMAIL, name: FROM_NAME },
      to: [{ email: to }],
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

// ── Wysyłka przez szablon (treść MIESZKA W services/email/templates/) ──
const { getTemplate } = require("./email/templates");

function sendPasswordEmail(to, password, extra = {}) {
  const tpl = getTemplate("password")({ password, ...extra });
  return sendMail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

module.exports = { sendMail, sendPasswordEmail, sendViaZepto, sendViaMailerSend };
