// services/email/templates/password.js — hasło do panelu kursanta
const { renderEmail, button, infoBox, esc } = require("../layout");

module.exports = function passwordTemplate({ password, panelUrl }) {
  const url = panelUrl || "https://panel.ceea.org.pl";
  const { html } = renderEmail({
    preheader: "Twoje hasło do Panelu uczestnika CEEA",
    title: "Panel uczestnika CEEA",
    content: `
      <p>Wygenerowaliśmy Twoje hasło do logowania:</p>
      ${infoBox(`<div style="text-align:center">
        <span style="font-family:monospace;font-size:26px;letter-spacing:2px;color:#111">
          <strong>${esc(password)}</strong></span>
      </div>`)}
      ${button("Zaloguj się do panelu", url)}
      <p style="font-size:13px;color:#6b7280">Jeśli nie prosiłeś o hasło, zignoruj tę wiadomość.</p>
    `,
  });

  return {
    subject: "Twoje hasło do Panelu CEEA",
    html,
    text: `Twoje hasło do Panelu CEEA: ${password}\n\nZaloguj się: ${url}\n\nJeśli nie prosiłeś o hasło, zignoruj tę wiadomość.`,
  };
};
