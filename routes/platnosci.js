const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const inpost = require("../services/inpost");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const CEEA_API = process.env.CEEA_API_URL;
const CEEA_ADMIN_KEY = process.env.CEEA_ADMIN_KEY;

const {
  generateInvoiceNumber,
  generateInvoicePDF,
} = require("../services/payments");



// ═══════════════════════════════════════════════════════════════
// ===== PŁATNOŚCI =====
// ═══════════════════════════════════════════════════════════════

router.get("/platnosci", adminOnly, requireAdmin, async (req, res) => {
  try {
    // kursy z Supabase — do filtra (value = course_id zgodne z payments.course_id)
    const { data: dbCourses, error: cErr } = await supabase
      .from("courses")
      .select("course_id, title, is_active, start_date")
      .order("start_date", { ascending: false });
    if (cErr) console.error("[GET /platnosci] courses:", cErr.message);
    const courses = dbCourses || [];
    const activeCourseId =
      courses.find((c) => c.is_active)?.course_id || null;

    // płatności za kursy
    const { data: paymentsRaw, error } = await supabase
      .from("payments")
      .select(
        "*, invoices!payments_invoice_id_fkey(*), users(name, surname, email, phone), courses(title)"
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const payments = paymentsRaw || [];

    // Faktury powiązane TYLKO przez invoices.payment_id (np. wygenerowane
    // z modułu Faktury, który nie ustawia payments.invoice_id) — dociągnij
    // je osobno i dopnij do płatności, żeby kolumna „Faktura" się zgadzała.
    const missingIds = payments.filter((p) => !p.invoices).map((p) => p.id);
    if (missingIds.length) {
      const { data: extraInv, error: eiErr } = await supabase
        .from("invoices")
        .select("*")
        .in("payment_id", missingIds)
        .order("created_at", { ascending: false });
      if (eiErr) console.error("[GET /platnosci] invoices fallback:", eiErr.message);
      const byPayment = new Map();
      (extraInv || []).forEach((i) => {
        if (i.payment_id && !byPayment.has(i.payment_id)) byPayment.set(i.payment_id, i);
      });
      payments.forEach((p) => {
        if (!p.invoices && byPayment.has(p.id)) p.invoices = byPayment.get(p.id);
      });
    }

    // płatności za książki
    const { data: bookOrders, error: boErr } = await supabase
      .from("book_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (boErr) console.error("[GET /platnosci] book_orders:", boErr.message);

    res.render("admin-platnosci", {
      isAdmin: true,
      active: "platnosci",
      courses,
      payments,
      bookOrders: bookOrders || [],
      activeCourseId,
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /platnosci]", err);
    res.render("admin-platnosci", {
      isAdmin: true,
      active: "platnosci",
      courses: [],
      payments: [],
      bookOrders: [],
      activeCourseId: null,
      query: {},
      error: err.message,
    });
  }
});
// Generuj fakturę
router.post(
  "/platnosci/:id/faktura",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { buyerName, buyerAddress, buyerNip } = req.body;

      const { data: pay } = await supabase
        .from("payments")
        .select("*, courses(title), users(email)") // ← users(email) dla buyer_email
        .eq("id", id)
        .single();
      if (!pay) throw new Error("Nie znaleziono płatności");

      const number = await generateInvoiceNumber(supabase);
      const gross = parseFloat(pay.amount);
      const net = +(gross / 1.23).toFixed(2);
      const vat = +(gross - net).toFixed(2);

      const items = [
        {
          name: `Udział w kursie: ${pay.courses?.title || "Kurs"}`, // ← title, nie nameCourse
          quantity: 1,
          unit: "szt.",
          net_price: net,
          vat_rate: 23,
          vat_amount: vat,
          gross_price: gross,
        },
      ];

      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert({
          invoice_number: number,
          payment_id: id,
          user_id: pay.user_id,
          course_id: pay.course_id,
          buyer_name: buyerName,
          buyer_address: buyerAddress,
          buyer_nip: buyerNip || null,
          buyer_email: pay.users?.email || null, // ← teraz zadziała (users dołączone wyżej)
          total_net: net,
          total_vat: vat,
          total_gross: gross,
          items,
          status: "issued",
        })
        .select()
        .single();
      if (invErr) throw invErr;

      await supabase
        .from("payments")
        .update({ invoice_id: inv.id })
        .eq("id", id);

      res.redirect(
        `${ADMIN_PREFIX}/platnosci?success=${encodeURIComponent(
          `Faktura ${number} wygenerowana`
        )}`
      );
    } catch (err) {
      res.redirect(
        `${ADMIN_PREFIX}/platnosci?error=${encodeURIComponent(err.message)}`
      );
    }
  }
);

// Pobierz PDF
router.get(
  "/platnosci/faktura/:id/pdf",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { pdfBuffer, invoice } = await generateInvoicePDF(
        supabase,
        req.params.id
      );
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${invoice.invoice_number}.pdf"`
      );
      res.send(pdfBuffer);
    } catch (err) {
      res.status(500).send("Błąd PDF: " + err.message);
    }
  }
);

router.get("/platnosci/ksiazki/:id", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: order, error } = await supabase
      .from("book_orders")
      .select("*")
      .eq("id", req.params.id)
      .single();
    if (error || !order) return res.redirect(ADMIN_PREFIX + "/platnosci");

    // Historia klienta (pozostałe zamówienia tego samego emaila)
    const { data: history } = await supabase
      .from("book_orders")
      .select("id, order_number, created_at, amount, status")
      .eq("email", order.email)
      .neq("id", order.id)
      .order("created_at", { ascending: false })
      .limit(10);

    res.render("admin-book-order", {
      isAdmin: true,
      active: "platnosci",
      order,
      history: history || [],
      inpostConfigured: !!(process.env.INPOST_API_TOKEN && process.env.INPOST_ORG_ID),
      inpostSandbox: inpost.isSandbox(),
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /platnosci/ksiazki/:id]", err);
    res.redirect(ADMIN_PREFIX + "/platnosci?error=" + encodeURIComponent(err.message));
  }
});

// Utwórz przesyłkę InPost
router.post("/platnosci/ksiazki/:id/wyslij", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: order, error } = await supabase
      .from("book_orders").select("*").eq("id", req.params.id).single();
    if (error || !order) throw new Error("Nie znaleziono zamówienia");
    if (order.tracking_number) throw new Error("Przesyłka już utworzona (numer: " + order.tracking_number + ")");
    if (order.status !== "paid") throw new Error("Zamówienie nie jest opłacone — najpierw oznacz płatność.");

    const shipment = await inpost.createLockerShipment(order, req.body.size || "small");

    await supabase.from("book_orders").update({
      tracking_number: String(shipment.id),
      inpost_status: shipment.status,
      parcel_size: shipment.size,
      status: "shipped",
      shipped_at: new Date().toISOString(),
    }).eq("id", order.id);

    res.redirect(`${ADMIN_PREFIX}/platnosci/ksiazki/${order.id}?success=` +
      encodeURIComponent(`Utworzono przesyłkę InPost (ID ${shipment.id})`));
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/platnosci/ksiazki/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// Etykieta PDF
router.get("/platnosci/ksiazki/:id/etykieta", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: order } = await supabase
      .from("book_orders").select("tracking_number").eq("id", req.params.id).single();
    if (!order?.tracking_number) throw new Error("Brak przesyłki dla tego zamówienia");

    const pdf = await inpost.getLabelPdf(order.tracking_number);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="etykieta-${order.tracking_number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/platnosci/ksiazki/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// Oznacz jako zapłacone
router.post(
  "/platnosci/:id/zaplacono",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: payment, error } = await supabase
        .from("payments")
        .select("order_number")
        .eq("id", req.params.id)
        .single();
      if (error || !payment) throw new Error("Nie znaleziono płatności");

      // serwis CEEA: status paid + automatyczny mail do kursanta
      const r = await fetch(`${CEEA_API}/mark-paid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": CEEA_ADMIN_KEY,
        },
        body: JSON.stringify({ orderNumber: payment.order_number }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || "Błąd serwisu płatności");

      // faktura powiązana -> paid
      const { data: pay } = await supabase
        .from("payments")
        .select("invoice_id")
        .eq("id", req.params.id)
        .single();
      if (pay?.invoice_id) {
        await supabase
          .from("invoices")
          .update({ status: "paid" })
          .eq("id", pay.invoice_id);
      }

      res.redirect(
        `${ADMIN_PREFIX}/platnosci?success=${encodeURIComponent(
          json.alreadyPaid
            ? "Ta płatność była już oznaczona jako opłacona."
            : "Oznaczono jako zapłacone. Kursant otrzymał mail z potwierdzeniem."
        )}`
      );
    } catch (err) {
      res.redirect(
        `${ADMIN_PREFIX}/platnosci?error=${encodeURIComponent(err.message)}`
      );
    }
  }
);

// Oznacz zamówienie książek jako opłacone
// (serwis CEEA: status paid + mail z potwierdzeniem do klienta i kopia do sekretariatu)
router.post(
  "/platnosci/ksiazki/:id/zaplacono",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: order, error } = await supabase
        .from("book_orders")
        .select("order_number")
        .eq("id", req.params.id)
        .single();
      if (error || !order) throw new Error("Nie znaleziono zamówienia");

      const r = await fetch(`${CEEA_API}/book-mark-paid`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": CEEA_ADMIN_KEY,
        },
        body: JSON.stringify({
          orderId: req.params.id,
          orderNumber: order.order_number,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || "Błąd serwisu płatności");

      res.redirect(
        `${ADMIN_PREFIX}/platnosci?success=${encodeURIComponent(
          json.alreadyPaid
            ? "To zamówienie było już oznaczone jako opłacone."
            : "Zaksięgowano wpłatę. Klient otrzymał mail z potwierdzeniem."
        )}`
      );
    } catch (err) {
      res.redirect(
        `${ADMIN_PREFIX}/platnosci?error=${encodeURIComponent(err.message)}`
      );
    }
  }
);

module.exports = router;