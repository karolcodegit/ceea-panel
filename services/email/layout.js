// services/email/layout.js — szkielet maila: header (logo CID) + main + footer
// Wszystkie szablony budują maila przez renderEmail() – spójny wygląd w całym panelu.
// Logo: inline CID (cid:ceea-logo) – mailer.js dokleja obrazek jako inline attachment.
// Design: biała karta na jasnoszarym tle (logo zawsze czytelne, także w dark mode
// klientów pocztowych), pasek brandowy CEEA, statyczny cień (bezpieczny wszędzie).

const ORG = {
  name: "Europejska Fundacja ds. Szkolenia w Anestezjologii",
  shortName: "CEEA Poznań",
  address: "ul. Sokolnicka 56, 62-021 Paczkowo",
  nip: "777-314-61-00",
  regon: "301341024",
  krs: "0000347155",
  email: process.env.ORG_EMAIL || "sekretariat@ceea.org.pl",
  phone: process.env.ORG_PHONE || "61 869 13 57",
  site: "https://ceea.org.pl",
  panel: "https://panel.ceea.org.pl",
};

const year = () => new Date().getFullYear();

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const button = (label, url) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0">
    <tr><td align="center">
      <a href="${url}" target="_blank"
         style="display:inline-block;background:#dc2626;color:#ffffff;text-decoration:none;
                font-family:Arial,Helvetica,sans-serif;font-weight:700;font-size:15px;
                padding:14px 36px;border-radius:10px;mso-padding-alt:0">
        <!--[if mso]>&nbsp;&nbsp;&nbsp;<![endif]-->${esc(label)}<!--[if mso]>&nbsp;&nbsp;&nbsp;<![endif]-->
      </a>
    </td></tr>
  </table>`;

const infoBox = (inner) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0">
    <tr><td style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:18px 20px">
      ${inner}
    </td></tr>
  </table>`;

const money = (v) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(Number(v) || 0);

const BRAND = "#dc2626";

function renderEmail({ preheader = "", title = "", content = "", footerNote = "" }) {
  const html = `<!DOCTYPE html>
<html lang="pl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="format-detection" content="telephone=no, address=no, email=no" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${esc(title || preheader || ORG.shortName)}</title>
  <!--[if mso]>
  <style>table {border-collapse:collapse} body,table,td {font-family:Arial,Helvetica,sans-serif !important}</style>
  <![endif]-->
  <style>
    body { margin:0; padding:0; background-color:#f3f4f6; font-family:Arial,Helvetica,sans-serif; color:#1f2937; line-height:1.65; -webkit-text-size-adjust:100%; }
    .card { max-width:600px; margin:24px auto; background-color:#ffffff; border-radius:16px; overflow:hidden;
            box-shadow:0 1px 3px rgba(16,24,40,.08), 0 8px 24px rgba(16,24,40,.06); }
    .brandbar { height:6px; background-color:${BRAND}; }
    .logo-wrap { padding:28px 36px 4px; background-color:#ffffff; }
    .logo { display:block; max-width:230px; height:auto; border:0; }
    .divider { height:1px; background-color:#eef0f3; margin:16px 36px 0; }
    .content { padding:12px 36px 32px; }
    h1 { font-size:21px; font-weight:700; color:#111827; margin:22px 0 16px; line-height:1.3; }
    p { font-size:15.5px; color:#374151; margin:0 0 16px; word-break:break-word; }
    a { color:${BRAND}; }
    strong { color:#111827; }
    .footer { background-color:#f9fafb; padding:24px 36px; }
    .footer p { font-size:12px; line-height:1.7; color:#6b7280; text-align:center; margin:0 0 8px; }
    .footer a { color:#6b7280; text-decoration:underline; }
    @media only screen and (max-width:600px) {
      .card { margin:0 !important; border-radius:0 !important; box-shadow:none !important; }
      .logo-wrap, .content, .footer { padding-left:20px !important; padding-right:20px !important; }
      .divider { margin-left:20px !important; margin-right:20px !important; }
      h1 { font-size:19px !important; }
      p { font-size:15px !important; }
    }
  </style>
</head>
<body>
  <!-- Preheader (podgląd w skrzynce) -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <div class="card">
    <div class="brandbar"></div>
    <div class="logo-wrap">
      <img class="logo" src="cid:ceea-logo" width="230" alt="${ORG.shortName}" />
    </div>
    <div class="divider"></div>

    <div class="content">
      ${title ? `<h1>${esc(title)}</h1>` : ""}
      ${content}
    </div>

    <div class="footer">
      ${footerNote ? `<p>${footerNote}</p>` : ""}
      <p>W razie pytań: <a href="mailto:${ORG.email}">${ORG.email}</a> &nbsp;|&nbsp; tel. ${ORG.phone}</p>
      <p>${ORG.name}<br />${ORG.address}<br />NIP: ${ORG.nip} &nbsp;·&nbsp; REGON: ${ORG.regon} &nbsp;·&nbsp; KRS: ${ORG.krs}</p>
      <p>Otrzymujesz tę wiadomość, ponieważ korzystasz z usług ${ORG.site.replace("https://", "www.")}.</p>
      <p>© ${year()} ${ORG.shortName}. Wszelkie prawa zastrzeżone.</p>
    </div>
  </div>
</body>
</html>`;

  return { html };
}

module.exports = { renderEmail, button, infoBox, money, esc, ORG };
