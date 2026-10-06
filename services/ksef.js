// services/ksef.js — SZKIELET integracji z KSeF (włączymy po stronie podatnika)
// Interfejs jest STAŁY – panel i reszta kodu woła te funkcje niezależnie,
// czy KSeF działa, czy nie. Dziś: bezpieczne „nieaktywne" odpowiedzi.
//
// Wdrożenie (przyszłość):
//   1. KSeF 2.0: token/cert (System uwierzytelniania), środowisko testowe
//   2. Generowanie XML faktury wg struktury FA(3) (pola invoices.items już są)
//   3. Wysyłka → zapisz ksef_invoice_id + ksef_status na fakturze
//   4. Polling/ webhook statusu → delivered / rejected + powiadomienie mail

const KSEF_ENABLED = process.env.KSEF_ENABLED === "true";
const KSEF_ENV = process.env.KSEF_ENV || "test"; // test | production

async function issueInvoice(invoice) {
  if (!KSEF_ENABLED) {
    return { ok: false, message: "KSeF nieaktywne – wystaw fakturę PDF ręcznie" };
  }
  // TODO: zbuduj FA(3) XML z invoice.items + buyer_*, wyślij do KSeF,
  // zaktualizuj invoices: ksef_invoice_id, ksef_status='sent', ksef_sent_at
  throw new Error("KSeF: implementacja w toku");
}

async function getInvoiceStatus(ksefInvoiceId) {
  if (!KSEF_ENABLED) return { ok: false, message: "KSeF nieaktywne" };
  // TODO: GET status faktury z KSeF (delivered / rejected + komunikat błędu)
  throw new Error("KSeF: implementacja w toku");
}

async function cancelInvoice(ksefInvoiceId) {
  if (!KSEF_ENABLED) return { ok: false, message: "KSeF nieaktywne" };
  // TODO: faktura ustrukturyzowana KSeF NIE jest anulowana – wysyła się
  // fakturę korygującą (duplikat => nota korygująca wg KSeF).
  throw new Error("KSeF: anulowanie = faktura korygująca (do zaimplementowania)");
}

module.exports = { issueInvoice, getInvoiceStatus, cancelInvoice, KSEF_ENABLED, KSEF_ENV };