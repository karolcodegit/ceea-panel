const puppeteer = require("puppeteer");
const numeral = require("numeral");

const year = new Date().getFullYear();

// ── BEZPIECZEŃSTWO (injection w PDF) ─────────────────────────
// Dane nabywcy i pozycje faktury pochodzą z formularza checkoutu,
// czyli od użytkownika. Wszystko ląduje w HTML renderowanym przez
// serwerowy Chromium — bez escapowania atakujący mógł wstrzyknąć
// własny HTML/JS do faktury. Dlatego KAŻDA wartość z zewnątrz
// przechodzi przez esc() przed wstawieniem do szablonu.
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

// adres bywa wielolinijkowy (\n z checkoutu) — po escapowaniu zamieniamy na <br>
const escNl2br = (s) => esc(s).replace(/\r?\n/g, "<br>");

// liczby z jsonb mogą przyjść jako string — przepuszczamy tylko sensowne znaki
const escNum = (v) => esc(String(v ?? "").replace(/[^\d.,\s-]/g, ""));

async function generateInvoiceNumber(supabase) {
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .gte("created_at", `${year}-01-01`)
    .lte("created_at", `${year}-12-31`);

  const next = (count || 0) + 1;
  return `FV/${year}/${String(next).padStart(4, "0")}`;
}

function invoiceTemplate(inv, courseName, userEmail) {
  const items = inv.items || [];
  const fmt = (n) => numeral(n).format("0,0.00");

  const rows = items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${esc(it.name)}</td>
      <td>${escNum(it.quantity)}</td>
      <td>${esc(it.unit)}</td>
      <td>${fmt(it.net_price)}</td>
      <td>${escNum(it.vat_rate)}%</td>
      <td>${fmt(it.vat_amount)}</td>
      <td>${fmt(it.gross_price)}</td>
    </tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="pl">
<head>
  <meta charset="UTF-8">
  <style>
    @page { size: A4; margin: 20mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #333; line-height: 1.5; margin: 0; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 30px; }
    .logo { font-size: 24px; font-weight: bold; color: #c0392b; }
    .meta { text-align: right; font-size: 11px; color: #555; }
    h1 { font-size: 18px; margin: 0 0 15px; color: #c0392b; }
    .box { border: 1px solid #ddd; padding: 12px; margin-bottom: 15px; border-radius: 4px; }
    .box strong { display: block; margin-bottom: 4px; font-size: 11px; text-transform: uppercase; color: #777; }
    table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    th { background: #f7f7f7; padding: 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #c0392b; }
    td { padding: 8px; border-bottom: 1px solid #eee; }
    .totals { margin-top: 15px; text-align: right; }
    .totals div { margin: 3px 0; }
    .totals .big { font-size: 14px; font-weight: bold; color: #c0392b; }
    .footer { margin-top: 40px; font-size: 10px; color: #777; border-top: 1px solid #ddd; padding-top: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">CEEA Poznań</div>
    <div class="meta">
      Faktura VAT nr <strong>${esc(inv.invoice_number)}</strong><br>
      Data wystawienia: ${esc(inv.issue_date)}<br>
      Termin płatności: ${esc(inv.due_date)}
    </div>
  </div>
  <div style="display:flex; gap:15px;">
    <div class="box" style="flex:1;">
      <strong>Sprzedawca</strong>
      Europejska Fundacja ds. Szkolenia w Anestezjologii<br>
      ul. Sokolnicka 56, 62-021 Paczkowo<br>
      NIP: 777-314-61-00
    </div>
    <div class="box" style="flex:1;">
      <strong>Nabywca</strong>
      ${esc(inv.buyer_name)}<br>
      ${escNl2br(inv.buyer_address)}<br>
      ${inv.buyer_nip ? `NIP: ${esc(inv.buyer_nip)}` : ""}
    </div>
  </div>
  <h1>${esc(courseName) || "Udział w kursie"}</h1>
  <table>
    <thead>
      <tr>
        <th>Lp.</th><th>Nazwa</th><th>Ilość</th><th>j.m.</th>
        <th>Cena netto</th><th>VAT</th><th>Kwota VAT</th><th>Wartość brutto</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="totals">
    <div>Razem netto: ${fmt(inv.total_net)} zł</div>
    <div>Razem VAT: ${fmt(inv.total_vat)} zł</div>
    <div class="big">Do zapłaty: ${fmt(inv.total_gross)} zł</div>
  </div>
  <div class="footer">
    Konto: 47 1140 2004 0000 3202 8319 5381<br>
    Tytuł: ${esc(inv.invoice_number)}<br>
    kontakt: sekretariat@ceea.org.pl
  </div>
</body>
</html>`;
}

async function generateInvoicePDF(supabase, invoiceId) {
  const { data: inv } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();

  if (!inv) throw new Error("Brak faktury");

  const { data: user } = await supabase
    .from("users")
    .select("email")
    .eq("id", inv.user_id)
    .single();

  const html = invoiceTemplate(inv, null, user?.email);

  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();

    // Tarcza nr 2: faktura jest w 100% self-contained, więc odcinamy
    // WSZYSTKIE żądania sieciowe — gdyby kiedykolwiek do HTML-a wszedł
    // zewnętrzny zasób/skrypt (błąd w escapowaniu, nowy kod), nie wykona się.
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("about:")) return req.continue();
      return req.abort();
    });

    await page.setContent(html, { waitUntil: "domcontentloaded" });
    const pdfBuffer = await page.pdf({ format: "A4", printBackground: true });

    return { pdfBuffer, invoice: inv };
  } finally {
    await browser.close(); // przy błędzie renderu proces Chromium nie zostaje w tle
  }
}

module.exports = { generateInvoiceNumber, generateInvoicePDF };
