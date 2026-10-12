const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const { fetchAllCourses } = require("../config/datocms");

const CEEA_API = process.env.CEEA_API_URL; // https://ceea-registration-course-...run.app
const CEEA_ADMIN_KEY = process.env.CEEA_ADMIN_KEY; // = ADMIN_KEY z Cloud Run

const {
  generateInvoiceNumber,
  generateInvoicePDF,
} = require("../services/payments");

// ═══════════════════════════════════════════════════════════════
// ===== PŁATNOŚCI =====
// ═══════════════════════════════════════════════════════════════

router.get("/platnosci", adminOnly, requireAdmin, async (req, res) => {
  try {
    const courses = await fetchAllCourses(); // DatoCMS – filtr (id zgodne z payments.course_id)

    // aktywny kurs z naszej tabeli (schema-fixes-v3/v4)
    const { data: dbCourses } = await supabase
      .from("courses")
      .select("course_id, is_active");
    const activeCourseId =
      (dbCourses || []).find((c) => c.is_active)?.course_id || null;

    const { data: payments, error } = await supabase
      .from("payments")
      .select(
        "*, invoices!payments_invoice_id_fkey(*), users(name, surname, email), courses(title)"
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    res.render("admin-platnosci", {
      isAdmin: true,
      active: "platnosci",
      courses,
      payments: payments || [],
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
        .select("*, courses(title), users(email)")   // ← users(email) dla buyer_email
        .eq("id", id)
        .single();
      if (!pay) throw new Error("Nie znaleziono płatności");

      const number = await generateInvoiceNumber(supabase);
      const gross = parseFloat(pay.amount);
      const net = +(gross / 1.23).toFixed(2);
      const vat = +(gross - net).toFixed(2);

      const items = [
        {
          name: `Udział w kursie: ${pay.courses?.title || "Kurs"}`,   // ← title, nie nameCourse
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
          buyer_email: pay.users?.email || null,   // ← teraz zadziała (users dołączone wyżej)
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

// Oznacz jako zapłacone
router.post(
  "/platnosci/:id/zaplacono",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: payment, error } = await supabase
        .from("payments").select("order_number").eq("id", req.params.id).single();
      if (error || !payment) throw new Error("Nie znaleziono płatności");

      // serwis CEEA: status paid + automatyczny mail do kursanta
      const r = await fetch(`${CEEA_API}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": CEEA_ADMIN_KEY },
        body: JSON.stringify({ orderNumber: payment.order_number }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json.error || "Błąd serwisu płatności");

      // faktura powiązana -> paid
      const { data: pay } = await supabase
        .from("payments").select("invoice_id").eq("id", req.params.id).single();
      if (pay?.invoice_id) {
        await supabase.from("invoices").update({ status: "paid" }).eq("id", pay.invoice_id);
      }

      res.redirect(`${ADMIN_PREFIX}/platnosci?success=${encodeURIComponent(
        json.alreadyPaid
          ? "Ta płatność była już oznaczona jako opłacona."
          : "Oznaczono jako zapłacone. Kursant otrzymał mail z potwierdzeniem."
      )}`);
    } catch (err) {
      res.redirect(`${ADMIN_PREFIX}/platnosci?error=${encodeURIComponent(err.message)}`);
    }
  }
);

module.exports = router;
