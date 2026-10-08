// services/email/templates/payment.js — potwierdzenia płatności
const { renderEmail, money } = require("../layout");

const success = function paymentSuccessTemplate({ firstName, amount, courseTitle, orderNumber }) {
  const { html } = renderEmail({
    preheader: `Potwierdzamy otrzymanie wpłaty za kurs "${courseTitle}"`,
    title: `Dzień dobry ${firstName || ""},`.trim(),
    content: `
      <p>potwierdzamy zaksięgowanie wpłaty <strong>${money(amount)}</strong> za udział
         w kursie <strong>"${courseTitle}"</strong>${orderNumber ? ` (zamówienie nr ${orderNumber})` : ""}.</p>
      <p>Twoje miejsce na kursie jest zarezerwowane. Faktura zostanie przesłana na koniec
         miesiąca, w którym nastąpiła płatność.</p>
      <p>Do zobaczenia na kursie!</p>
    `,
  });

  return {
    subject: `Potwierdzenie płatności – kurs "${courseTitle}" – CEEA Poznań`,
    html,
    text: `Dzień dobry ${firstName || ""},\n\npotwierdzamy zaksięgowanie wpłaty ${money(amount)} za kurs "${courseTitle}"${orderNumber ? ` (nr ${orderNumber})` : ""}.\n\nDo zobaczenia na kursie!`,
  };
};

module.exports = { success };
