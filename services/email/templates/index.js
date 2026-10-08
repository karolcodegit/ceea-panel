// services/email/templates/index.js — rejestr szablonów maili panelu
// Każdy szablon: (data) => { subject, preheader, title, content, text }
const password = require("./password");
const payment = require("./payment");
const invoice = require("./invoice");

const templates = {
  password,
  paymentSuccess: payment.success,
  invoiceKsef: invoice.ksef,
  invoiceIssued: invoice.issued,
};

const getTemplate = key => {
  const t = templates[key];
  if (!t) throw new Error(`Nieznany szablon maila: "${key}"`);
  return t;
};

module.exports = { templates, getTemplate };
