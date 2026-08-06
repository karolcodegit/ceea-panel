// services/mailer.js
const MAILERSEND_API_KEY = process.env.MAILERSEND_API_KEY;
const FROM_EMAIL = process.env.MAIL_FROM_EMAIL || "sekretariat@ceea.org.pl";
const FROM_NAME = process.env.MAIL_FROM_NAME || "CEEA Panel";

async function sendMail({ to, subject, html, text }) {
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
    }),
  });

  // MailerSend zwraca 202 z pustym body przy sukcesie
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`MailerSend ${res.status}: ${body}`);
  }
}

function sendPasswordEmail(to, password) {
  return sendMail({
    to,
    subject: "Twoje hasło do Panelu CEEA",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#dc2626;margin:0 0 16px">Panel uczestnika CEEA</h2>
        <p style="color:#111">Wygenerowaliśmy Twoje hasło do logowania:</p>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;text-align:center;margin:16px 0">
          <span style="font-family:monospace;font-size:26px;letter-spacing:2px;color:#111"><strong>${password}</strong></span>
        </div>
        <p style="color:#111">Zaloguj się: <a href="https://panel.ceea.org.pl" style="color:#dc2626">panel.ceea.org.pl</a></p>
        <p style="color:#6b7280;font-size:13px;margin-top:24px">Jeśli nie prosiłeś o hasło, zignoruj tę wiadomość.</p>
      </div>
    `,
    text: `Twoje hasło do Panelu CEEA: ${password}\n\nZaloguj się: https://panel.ceea.org.pl\n\nJeśli nie prosiłeś o hasło, zignoruj tę wiadomość.`,
  });
}

module.exports = { sendMail, sendPasswordEmail };