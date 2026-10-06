// ═══════════════════════════════════════════════════════════════
// ===== FAKTURY (widok: kto potrzebuje faktury + dane z formularza) =====
// ═══════════════════════════════════════════════════════════════
// Wklej do routera panelu (np. pod sekcją PŁATNOŚCI). Wymaga widoku admin-faktury.ejs.

const ksef = require("../services/ksef");

// Czy płatność ma dane faktury? (dwie konwencje pól: nowa forma + migracja z Airtable)
const needsInvoice = p =>
  !!p && (
    p.wantsInvoice === true || p.wantsInvoice === "true" ||
    (p.InvoiceName || p.invoiceName || "").toString().trim() !== "" ||
    (p.InvoiceNip || p.invoiceNip || "").toString().trim() !== ""
  );

const extractInvoice = p => ({
  name:      (p.InvoiceName      || p.invoiceName      || "").toString().trim(),
  street:    (p.InvoiceStreet    || p.invoiceStreet    || "").toString().trim(),
  numberHome:(p.InvoiceNumberHome|| p.invoiceNumberHome|| "").toString().trim(),
  zipCode:   (p.InvoiceZipCode   || p.invoiceZipCode   || "").toString().trim(),
  city:      (p.InvoiceCity      || p.invoiceCity      || "").toString().trim(),
  nip:       (p.InvoiceNip       || p.invoiceNip       || "").toString().trim(),
});

router.get("/faktury", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: payments, error } = await supabase
      .from("payments")
      .select("id, order_number, amount, status, course_id, payload, invoice_id, created_at, users(name, surname, email), invoices!payments_invoice_id_fkey(*)")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const invoices = (payments || [])
      .filter(p => needsInvoice(p.payload))
      .map(p => ({ ...p, invoiceData: extractInvoice(p.payload) }));

    const { data: coursesDb } = await supabase.from("courses").select("course_id, title");
    const courseTitles = Object.fromEntries((coursesDb || []).map(c => [c.course_id, c.title]));

    res.render("admin-faktury", {
      isAdmin: true,
      active: "faktury",
      invoices,
      courseTitles,
      ksefEnabled: ksef.KSEF_ENABLED,
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /faktury]", err);
    res.render("admin-faktury", {
      isAdmin: true, active: "faktury",
      invoices: [], courseTitles: {}, ksefEnabled: false, query: {},
      error: err.message,
    });
  }
});