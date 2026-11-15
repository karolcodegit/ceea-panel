const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const inpost = require("../services/inpost");
const {
  sendShipmentCanceledEmail,
  sendShipmentSentEmail,
  sendOrderCanceledEmail,
  sendCourseRemovedEmail,
} = require("../services/mailer");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const CEEA_API = process.env.CEEA_API_URL;
const CEEA_ADMIN_KEY = process.env.CEEA_ADMIN_KEY;

const {
  generateInvoiceNumber,
  generateInvoicePDF,
} = require("../services/payments");


// ═══════════════════════════════════════════════════════════════
// ── InPost: pomocnicze ──
// ═══════════════════════════════════════════════════════════════

// Rozmiar paczki z liczby sztuk w zamówieniu.
// UWAGA: dopasuj progi do gabarytów książek (A ≤2 szt., B ≤5 szt., C powyżej).
function autoParcelSize(order) {
  const count = (Array.isArray(order.items) ? order.items : []).reduce(
    (s, it) => s + (Number(it.qty) || Number(it.quantity) || 1),
    0
  );
  return count <= 2 ? "small" : count <= 5 ? "medium" : "large";
}

// Normalizacja metody dostawy (w bazie bywają różne zapisy).
function deliveryKindOf(order) {
  const m = String(order.delivery_method || "").toLowerCase();
  if (m.includes("paczkomat") || m.includes("inpost") || m.includes("parcel"))
    return "parcel_locker";
  if (m.includes("kurier") || m.includes("courier")) return "courier";
  return "other";
}

// Numeryczne ID przesyłki ShipX.
// Nowe zamówienia: kolumna inpost_shipment_id.
// Starsze: shipment.id było zapisywane w tracking_number (sam numer → wykrywamy).
function shipmentIdOf(order) {
  if (order.inpost_shipment_id) return order.inpost_shipment_id;
  if (order.tracking_number && /^\d+$/.test(String(order.tracking_number)))
    return Number(order.tracking_number);
  return null;
}

// Zapis danych świeżo utworzonej przesyłki do zamówienia.
// UWAGA: inpost.js zwraca camelCase → shipment.trackingNumber (nie tracking_number!).
// Utworzenie przesyłki NIE zmienia statusu zamówienia — zostaje „Opłacone"
// do czasu kliknięcia osobnej akcji „Wysłane" (kontrola stanu magazynowego).
async function saveShipmentToOrder(orderId, shipment, size) {
  await supabase
    .from("book_orders")
    .update({
      inpost_shipment_id: shipment.id,
      // ShipX czasem zwraca numer dopiero później — dociągnie go odświeżanie statusu
      tracking_number: shipment.trackingNumber
        ? String(shipment.trackingNumber)
        : null,
      inpost_status: shipment.status || null,
      inpost_status_at: new Date().toISOString(),
      parcel_size: shipment.size || size,
    })
    .eq("id", orderId);
}

// Wyczyszczenie danych przesyłki po jej anulowaniu.
async function clearShipmentFromOrder(orderId) {
  await supabase
    .from("book_orders")
    .update({
      inpost_shipment_id: null,
      tracking_number: null,
      inpost_status: null,
      inpost_status_at: null,
      parcel_size: null,
      shipped_at: null,
    })
    .eq("id", orderId);
}

// Automatyczne utworzenie przesyłki po zaksięgowaniu wpłaty.
// Paczkomat → inpost_locker_standard; kurier → inpost_courier_standard
// (kurier może się nie udać przy błędnym adresie — wtedy wyjątek,
//  płatność zostaje, przesyłkę tworzysz ręcznie ze szczegółów zamówienia).
async function autoCreateShipment(order) {
  if (shipmentIdOf(order) || order.tracking_number) return { skipped: "exists" };
  if (!process.env.INPOST_API_TOKEN || !process.env.INPOST_ORG_ID)
    return { skipped: "no-config" };

  const kind = deliveryKindOf(order);
  const size = autoParcelSize(order);

  if (kind === "parcel_locker") {
    const shipment = await inpost.createLockerShipment(order, size);
    await saveShipmentToOrder(order.id, shipment, size);
    return { shipment };
  }
  if (kind === "courier") {
    const shipment = await inpost.createCourierShipment(order, size);
    await saveShipmentToOrder(order.id, shipment, size);
    return { shipment };
  }
  return { skipped: "other-delivery" };
}

// Wysyłka maila systemowego — błąd maila NIGDY nie przerywa operacji
// (zamówienie/przesyłka już się zmieniły; logujemy i jedziemy dalej).
async function trySendMail(label, fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    console.error(`[platnosci] mail „${label}” nie wyszedł:`, e.message);
    return false;
  }
}


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
    const bookList = bookOrders || [];

    // Faktury książkowe: powiązanie przez invoices.book_order_id
    // (migracja faktury-unifikacja.sql). Try/catch — przed migracją
    // kolumna nie istnieje i panel ma działać dalej (kolumna pokaże „—").
    if (bookList.length) {
      try {
        const { data: bookInv, error: biErr } = await supabase
          .from("invoices")
          .select("*")
          .in("book_order_id", bookList.map((o) => o.id));
        if (biErr) throw biErr;
        const byOrder = new Map((bookInv || []).map((i) => [i.book_order_id, i]));
        bookList.forEach((o) => {
          o.invoices = byOrder.get(o.id) || null;
        });
      } catch (e) {
        console.error("[GET /platnosci] invoices (książki):", e.message);
        bookList.forEach((o) => {
          o.invoices = null;
        });
      }
    }

    res.render("admin-platnosci", {
      isAdmin: true,
      active: "platnosci",
      courses,
      payments,
      bookOrders: bookList,
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

      const back = req.body && req.body.back === "kursy" ? `/kursy/${id}` : "";
      res.redirect(
        `${ADMIN_PREFIX}/platnosci${back}?success=${encodeURIComponent(
          `Faktura ${number} wygenerowana`
        )}`
      );
    } catch (err) {
      const back = req.body && req.body.back === "kursy" ? `/kursy/${req.params.id}` : "";
      res.redirect(
        `${ADMIN_PREFIX}/platnosci${back}?error=${encodeURIComponent(err.message)}`
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

// ═══════════════════════════════════════════════════════════════
// Faktura za ZAMÓWIENIE KSIĄŻEK — ląduje w TEJ SAMEJ tabeli
// invoices co faktury kursowe (powiązanie: invoices.book_order_id).
// Dzięki temu obsługuje ją moduł Faktury, PDF i KSeF bez zmian.
// ═══════════════════════════════════════════════════════════════

// VAT dla książek drukowanych = 5%. Jeśli księgowość rozlicza inaczej
// (np. e-booki 23%), zmień tylko tę stałą.
const BOOK_VAT_RATE = 5;

function splitGross(grossAmount, vatRate) {
  const gross = +(+grossAmount).toFixed(2);
  const net = +(gross / (1 + vatRate / 100)).toFixed(2);
  return { net, vat: +(gross - net).toFixed(2), gross };
}

// Pozycje faktury z items jsonb zamówienia. Ceny w sklepie są brutto.
// Jeśli suma pozycji nie pokrywa kwoty zamówienia — różnica to koszt
// dostawy i ląduje jako osobna pozycja. Bez cen w items → jedna pozycja
// zbiorcza na całą kwotę.
function bookInvoiceItems(order) {
  const amount = Number(order.amount) || 0;
  const src = Array.isArray(order.items) ? order.items : [];
  const lines = [];

  for (const it of src) {
    const qty = Number(it.qty || it.quantity) || 1;
    const unitGross = Number(it.price);
    if (!unitGross || unitGross <= 0) continue; // brak ceny → fallback niżej
    const { net, vat, gross } = splitGross(unitGross * qty, BOOK_VAT_RATE);
    lines.push({
      name: it.title || it.name || "Książka",
      quantity: qty,
      unit: "szt.",
      net_price: net,
      vat_rate: BOOK_VAT_RATE,
      vat_amount: vat,
      gross_price: gross,
    });
  }

  if (!lines.length) {
    const { net, vat, gross } = splitGross(amount, BOOK_VAT_RATE);
    return [
      {
        name: `Zamówienie książek ${order.order_number || ""}`.trim(),
        quantity: 1,
        unit: "szt.",
        net_price: net,
        vat_rate: BOOK_VAT_RATE,
        vat_amount: vat,
        gross_price: gross,
      },
    ];
  }

  const sum = +lines.reduce((s, l) => s + l.gross_price, 0).toFixed(2);
  const diff = +(amount - sum).toFixed(2);
  if (Math.abs(diff) >= 0.01) {
    const d = splitGross(diff, BOOK_VAT_RATE); // dostawa wg stawki towaru
    lines.push({
      name: "Koszt dostawy",
      quantity: 1,
      unit: "szt.",
      net_price: d.net,
      vat_rate: BOOK_VAT_RATE,
      vat_amount: d.vat,
      gross_price: d.gross,
    });
  }
  return lines;
}

// Domyślne dane nabywcy z kolumn checkoutu (want_invoice / invoice_*)
function bookInvoiceDefaults(order) {
  return {
    name: (order.invoice_name || `${order.name || ""} ${order.surname || ""}`.trim()).trim(),
    address: [
      [order.invoice_street, order.invoice_number_home].filter(Boolean).join(" "),
      [order.invoice_postcode, order.invoice_city].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join("\n"),
    nip: order.invoice_nip || "",
  };
}

router.post(
  "/platnosci/ksiazki/:id/faktura",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    const back = req.body && req.body.back === "order" ? `/ksiazki/${req.params.id}` : "";
    try {
      const { data: order, error } = await supabase
        .from("book_orders")
        .select("*")
        .eq("id", req.params.id)
        .single();
      if (error || !order) throw new Error("Nie znaleziono zamówienia");

      // Już wystawiona? (po invoice_id albo po invoices.book_order_id)
      if (order.invoice_id) throw new Error("Faktura jest już wystawiona dla tego zamówienia.");
      {
        const { data: existing } = await supabase
          .from("invoices")
          .select("id, invoice_number")
          .eq("book_order_id", order.id)
          .limit(1)
          .maybeSingle();
        if (existing) throw new Error(`Faktura ${existing.invoice_number} jest już wystawiona.`);
      }

      const dfl = bookInvoiceDefaults(order);
      const buyerName = (req.body.buyerName || "").trim() || dfl.name;
      const buyerAddress = (req.body.buyerAddress || "").trim() || dfl.address;
      const buyerNip = (req.body.buyerNip || "").trim() || dfl.nip;
      if (!buyerName) throw new Error("Podaj nazwę nabywcy (klient nie uzupełnił danych do faktury).");

      const number = await generateInvoiceNumber(supabase);
      const items = bookInvoiceItems(order);
      const totalNet = +items.reduce((s, l) => s + l.net_price, 0).toFixed(2);
      const totalGross = +items.reduce((s, l) => s + l.gross_price, 0).toFixed(2);
      const totalVat = +(totalGross - totalNet).toFixed(2);

      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .insert({
          invoice_number: number,
          payment_id: null,
          book_order_id: order.id,
          user_id: null,
          course_id: null,
          buyer_name: buyerName,
          buyer_address: buyerAddress,
          buyer_nip: buyerNip || null,
          buyer_email: order.email || null,
          total_net: totalNet,
          total_vat: totalVat,
          total_gross: totalGross,
          items,
          // opłacone zamówienie → faktura od razu „paid" (jak przy kursach po zaplacono)
          status: ["paid", "shipped", "completed"].includes(order.status) ? "paid" : "issued",
        })
        .select()
        .single();
      if (invErr) throw invErr;

      await supabase
        .from("book_orders")
        .update({ invoice_id: inv.id })
        .eq("id", order.id);

      res.redirect(
        `${ADMIN_PREFIX}/platnosci${back}?success=${encodeURIComponent(
          `Faktura ${number} wygenerowana`
        )}`
      );
    } catch (err) {
      res.redirect(
        `${ADMIN_PREFIX}/platnosci${back}?error=${encodeURIComponent(err.message)}`
      );
    }
  }
);

// Usuń uczestnika z kursu (akcja w tabeli Kursy).
// Usuwa: zapis(y) w enrollments + rekord payments.
// ZOSTAJE: konto użytkownika i faktura (archiwum księgowe).
// Wysyła systemowego maila o usunięciu z listy uczestników.
router.post(
  "/platnosci/:id/usun-uczestnika",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: payment, error } = await supabase
        .from("payments")
        .select("*, users(name, surname, email), courses(title)")
        .eq("id", req.params.id)
        .single();
      if (error || !payment) throw new Error("Nie znaleziono płatności");

      const userEmail = payment.users?.email;
      const userName = payment.users?.name || "";
      const userSurname = payment.users?.surname || "";
      const courseTitle = payment.courses?.title || "Kurs CEEA";
      const wasPaid = payment.status === "paid";

      // 1) zapisy na kurs (może być kilka — usuwamy wszystkie tego usera na ten kurs)
      if (payment.user_id && payment.course_id != null) {
        const { error: enErr } = await supabase
          .from("enrollments")
          .delete()
          .eq("user_id", payment.user_id)
          .eq("course_id", payment.course_id);
        if (enErr) throw new Error("Błąd usuwania zapisu na kurs: " + enErr.message);
      }

      // 2) rekord płatności
      const { error: payErr } = await supabase
        .from("payments")
        .delete()
        .eq("id", payment.id);
      if (payErr) throw new Error("Błąd usuwania płatności: " + payErr.message);

      // 3) mail do uczestnika (błąd maila nie cofa usunięcia)
      let mailInfo = "";
      if (userEmail) {
        const sent = await trySendMail("usunięcie z kursu", () =>
          sendCourseRemovedEmail(userEmail, {
            firstName: userName,
            surname: userSurname,
            courseTitle,
            wasPaid,
          })
        );
        mailInfo = sent
          ? " Wysłano mail z potwierdzeniem do uczestnika."
          : " UWAGA: nie udało się wysłać maila do uczestnika.";
      }

      res.redirect(
        `${ADMIN_PREFIX}/platnosci?success=${encodeURIComponent(
          `Usunięto ${`${userName} ${userSurname}`.trim() || userEmail} z listy uczestników kursu „${courseTitle}”.` +
            (wasPaid ? " Pamiętaj o zwrocie wpłaty!" : "") +
            mailInfo
        )}`
      );
    } catch (err) {
      res.redirect(
        `${ADMIN_PREFIX}/platnosci?error=${encodeURIComponent(err.message)}`
      );
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

    // Faktura (po migracji: invoices.book_order_id; try/catch = działa też przed migracją)
    let invoice = null;
    try {
      const { data: inv } = await supabase
        .from("invoices")
        .select("*")
        .eq("book_order_id", order.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      invoice = inv || null;
    } catch (e) {
      console.error("[GET /platnosci/ksiazki/:id] invoice:", e.message);
    }

    res.render("admin-book-order", {
      isAdmin: true,
      active: "platnosci",
      order,
      invoice,
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

// Utwórz przesyłkę InPost (ręcznie, ze szczegółów zamówienia)
router.post("/platnosci/ksiazki/:id/wyslij", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: order, error } = await supabase
      .from("book_orders").select("*").eq("id", req.params.id).single();
    if (error || !order) throw new Error("Nie znaleziono zamówienia");
    if (shipmentIdOf(order) || order.tracking_number)
      throw new Error("Przesyłka już utworzona" + (order.tracking_number ? " (numer: " + order.tracking_number + ")" : ""));
    if (order.status !== "paid") throw new Error("Zamówienie nie jest opłacone — najpierw oznacz płatność.");

    const size = req.body.size || autoParcelSize(order);
    const kind = deliveryKindOf(order);

    let shipment;
    if (kind === "courier") {
      shipment = await inpost.createCourierShipment(order, size, req.body.sending_method || "dispatch_order");
    } else if (kind === "parcel_locker") {
      shipment = await inpost.createLockerShipment(order, size);
    } else {
      throw new Error(`Nieznana metoda dostawy „${order.delivery_method}” — utwórz przesyłkę bezpośrednio w Managerze InPost.`);
    }

    await saveShipmentToOrder(order.id, shipment, size);

    res.redirect(`${ADMIN_PREFIX}/platnosci/ksiazki/${order.id}?success=` +
      encodeURIComponent(`Utworzono przesyłkę InPost (ID ${shipment.id}). Zamówienie pozostaje „Opłacone” — po sprawdzeniu stanu magazynowego kliknij „Wysłane”.`));
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/platnosci/ksiazki/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// Oznacz zamówienie jako WYSŁANE — osobna akcja PO utworzeniu przesyłki
// i sprawdzeniu stanu magazynowego. Dopiero teraz klient dostaje maila
// o wysyłce (z numerem śledzenia i linkiem do śledzenia / panelu).
router.post("/platnosci/ksiazki/:id/wyslano", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: order, error } = await supabase
      .from("book_orders").select("*").eq("id", req.params.id).single();
    if (error || !order) throw new Error("Nie znaleziono zamówienia");
    if (order.status === "shipped") throw new Error("Zamówienie jest już oznaczone jako wysłane.");
    if (order.status !== "paid") throw new Error("Najpierw zaksięguj płatność (przycisk „Zapłacono”).");

    await supabase.from("book_orders").update({
      status: "shipped",
      shipped_at: new Date().toISOString(),
    }).eq("id", order.id);

    // Mail do klienta o wysyłce (błąd maila nie cofa zmiany statusu)
    let mailInfo = "";
    if (order.email) {
      const sent = await trySendMail("wysyłka zamówienia", () =>
        sendShipmentSentEmail(order.email, order)
      );
      mailInfo = sent
        ? " Klient otrzymał mail z potwierdzeniem wysyłki."
        : " UWAGA: nie udało się wysłać maila do klienta.";
    }

    // back=order → powrót na stronę szczegółów zamówienia
    const back = req.body.back === "order" ? `/ksiazki/${order.id}` : "";
    res.redirect(`${ADMIN_PREFIX}/platnosci${back}?success=` +
      encodeURIComponent(`Zamówienie ${order.order_number || ""} oznaczone jako wysłane.` + mailInfo));
  } catch (err) {
    const back = req.body && req.body.back === "order" ? `/ksiazki/${req.params.id}` : "";
    res.redirect(`${ADMIN_PREFIX}/platnosci${back}?error=` + encodeURIComponent(err.message));
  }
});

// Anuluj przesyłkę InPost — zamówienie wraca do statusu „paid"
router.post("/platnosci/ksiazki/:id/usun-przesylke", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: order, error } = await supabase
      .from("book_orders").select("*").eq("id", req.params.id).single();
    if (error || !order) throw new Error("Nie znaleziono zamówienia");

    const shipmentId = shipmentIdOf(order);
    if (!shipmentId) throw new Error("To zamówienie nie ma przesyłki InPost.");

    await inpost.cancelShipment(shipmentId);
    await clearShipmentFromOrder(order.id);
    await supabase.from("book_orders").update({ status: "paid" }).eq("id", order.id);

    // Mail do klienta o anulowanej przesyłce (błąd maila nie cofa operacji)
    let mailInfo = "";
    if (order.email) {
      const sent = await trySendMail("anulowanie przesyłki", () =>
        sendShipmentCanceledEmail(order.email, order)
      );
      mailInfo = sent
        ? " Klient otrzymał mail z potwierdzeniem."
        : " UWAGA: nie udało się wysłać maila do klienta.";
    }

    res.redirect(`${ADMIN_PREFIX}/platnosci/ksiazki/${order.id}?success=` +
      encodeURIComponent("Przesyłka InPost anulowana. Zamówienie wróciło do statusu „Opłacone”." + mailInfo));
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/platnosci/ksiazki/${req.params.id}?error=` + encodeURIComponent(err.message));
  }
});

// Anuluj CAŁE zamówienie (klient się rozmyślił).
// Jeśli istnieje przesyłka InPost — najpierw anulujemy ją; gdy InPost odmówi
// (paczka już w drodze), cała operacja jest przerywana i zamówienie zostaje.
router.post("/platnosci/ksiazki/:id/anuluj", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: order, error } = await supabase
      .from("book_orders").select("*").eq("id", req.params.id).single();
    if (error || !order) throw new Error("Nie znaleziono zamówienia");
    if (order.status === "canceled") throw new Error("Zamówienie jest już anulowane.");

    const shipmentId = shipmentIdOf(order);
    if (shipmentId) {
      await inpost.cancelShipment(shipmentId);
      await clearShipmentFromOrder(order.id);
    }

    await supabase.from("book_orders").update({ status: "canceled" }).eq("id", order.id);

    // Mail do klienta o anulowanym zamówieniu (błąd maila nie cofa operacji)
    let mailInfo = "";
    if (order.email) {
      const sent = await trySendMail("anulowanie zamówienia", () =>
        sendOrderCanceledEmail(order.email, order, { wasPaid: order.status === "paid" })
      );
      mailInfo = sent
        ? " Klient otrzymał mail z potwierdzeniem."
        : " UWAGA: nie udało się wysłać maila do klienta.";
    }

    res.redirect(`${ADMIN_PREFIX}/platnosci?success=` +
      encodeURIComponent(`Zamówienie ${order.order_number || ""} zostało anulowane.` + mailInfo));
  } catch (err) {
    res.redirect(`${ADMIN_PREFIX}/platnosci?error=` + encodeURIComponent(err.message));
  }
});

// Etykieta PDF
router.get("/platnosci/ksiazki/:id/etykieta", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: order } = await supabase
      .from("book_orders").select("inpost_shipment_id, tracking_number").eq("id", req.params.id).single();
    const shipmentId = order && shipmentIdOf(order);
    if (!shipmentId) throw new Error("Brak przesyłki dla tego zamówienia");

    const pdf = await inpost.getLabelPdf(shipmentId);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="etykieta-${shipmentId}.pdf"`);
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
        `${ADMIN_PREFIX}/platnosci${req.body && req.body.back === "kursy" ? `/kursy/${req.params.id}` : ""}?success=${encodeURIComponent(
          json.alreadyPaid
            ? "Ta płatność była już oznaczona jako opłacona."
            : "Oznaczono jako zapłacone. Kursant otrzymał mail z potwierdzeniem."
        )}`
      );
    } catch (err) {
      res.redirect(
        `${ADMIN_PREFIX}/platnosci${req.body && req.body.back === "kursy" ? `/kursy/${req.params.id}` : ""}?error=${encodeURIComponent(err.message)}`
      );
    }
  }
);

// Oznacz zamówienie książek jako opłacone
// (serwis CEEA: status paid + mail z potwierdzeniem do klienta i kopia do sekretariatu)
// Po zaksięgowaniu: AUTOMATYCZNE utworzenie przesyłki InPost (paczkomat i kurier).
router.post(
  "/platnosci/ksiazki/:id/zaplacono",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: order, error } = await supabase
        .from("book_orders")
        .select("*") // pełny rekord — potrzebny do auto-przesyłki
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

      // faktura powiązana -> paid (lustro logiki z kursów)
      if (order.invoice_id) {
        await supabase
          .from("invoices")
          .update({ status: "paid" })
          .eq("id", order.invoice_id);
      }
      // Auto-przesyłka po zaksięgowaniu. Błąd InPost NIE cofa płatności —
      // dokłada tylko ostrzeżenie do komunikatu (przesyłkę utworzysz ręcznie).
      // Zamówienie ZOSTAJE „Opłacone" — osobna akcja „Wysłane" kończy proces.
      let shipMsg = "";
      try {
        const auto = await autoCreateShipment(order);
        if (auto.shipment) shipMsg = " Przesyłka InPost utworzyła się automatycznie — po sprawdzeniu stanu magazynowego kliknij „Wysłane”.";
        else if (auto.skipped === "other-delivery")
          shipMsg = " Nietypowa metoda dostawy — przesyłkę utwórz ręcznie w Managerze InPost.";
      } catch (e) {
        console.error("[ksiazki/zaplacono] auto-przesyłka:", e.message);
        shipMsg = " UWAGA: nie utworzono przesyłki (" + e.message + ") — utwórz ją ręcznie ze szczegółów zamówienia.";
      }

      // back=order → powrót na stronę szczegółów zamówienia
      const back = req.body.back === "order" ? `/ksiazki/${order.id}` : "";
      res.redirect(
        `${ADMIN_PREFIX}/platnosci${back}?success=${encodeURIComponent(
          (json.alreadyPaid
            ? "To zamówienie było już oznaczone jako opłacone."
            : "Zaksięgowano wpłatę. Klient otrzymał mail z potwierdzeniem.") + shipMsg
        )}`
      );
    } catch (err) {
      const back = req.body && req.body.back === "order" ? `/ksiazki/${req.params.id}` : "";
      res.redirect(
        `${ADMIN_PREFIX}/platnosci${back}?error=${encodeURIComponent(err.message)}`
      );
    }
  }
);

// ═══════════════════════════════════════════════════════════════
// SZCZEGÓŁY płatności kursowej (odpowiednik strony zamówienia książek)
// ═══════════════════════════════════════════════════════════════
router.get("/platnosci/kursy/:id", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: payment, error } = await supabase
      .from("payments")
      .select(
        "*, invoices!payments_invoice_id_fkey(*), users(name, surname, email, phone, created_at), courses(title, start_date)"
      )
      .eq("id", req.params.id)
      .single();
    if (error || !payment) return res.redirect(ADMIN_PREFIX + "/platnosci");

    // Faktura powiązana TYLKO przez invoices.payment_id (moduł Faktury
    // nie ustawia payments.invoice_id) — fallback jak na liście.
    let invoice = payment.invoices || null;
    if (!invoice) {
      const { data: inv } = await supabase
        .from("invoices")
        .select("*")
        .eq("payment_id", payment.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      invoice = inv || null;
    }

    // Czy uczestnik jest na liście kursu (enrollments)
    let enrolled = null;
    if (payment.user_id && payment.course_id != null) {
      const { count } = await supabase
        .from("enrollments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", payment.user_id)
        .eq("course_id", payment.course_id);
      enrolled = (count || 0) > 0;
    }

    res.render("admin-course-payment", {
      isAdmin: true,
      active: "platnosci",
      payment,
      invoice,
      enrolled,
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /platnosci/kursy/:id]", err);
    res.redirect(ADMIN_PREFIX + "/platnosci?error=" + encodeURIComponent(err.message));
  }
});

// Edycja danych ze strony szczegółów:
//  • dane uczestnika → tabela users (po user_id)
//  • notatki        → payments.notes
// Statusu i kwoty świadomie tu NIE edytujemy: status zmieniają akcje
// (maile!), a kwota musi być spójna z wystawioną fakturą.
router.post("/platnosci/kursy/:id/edytuj", adminOnly, requireAdmin, async (req, res) => {
  const back = `${ADMIN_PREFIX}/platnosci/kursy/${req.params.id}`;
  try {
    const { data: payment, error } = await supabase
      .from("payments")
      .select("id, user_id, order_number, users(email)")
      .eq("id", req.params.id)
      .single();
    if (error || !payment) throw new Error("Nie znaleziono płatności");

    const name = (req.body.name || "").trim();
    const surname = (req.body.surname || "").trim();
    const phone = (req.body.phone || "").trim();
    const email = (req.body.email || "").trim().toLowerCase();

    let emailChanged = false;
    if (payment.user_id) {
      if (email && !/\S+@\S+\.\S+/.test(email))
        throw new Error("Podany adres e-mail wygląda na nieprawidłowy.");
      const upd = {};
      if (name) upd.name = name;
      if (surname) upd.surname = surname;
      if (phone) upd.phone = phone;
      if (email && email !== payment.users?.email) {
        upd.email = email;
        emailChanged = true;
      }
      if (Object.keys(upd).length) {
        const { error: uErr } = await supabase
          .from("users")
          .update(upd)
          .eq("id", payment.user_id);
        if (uErr) throw new Error("Błąd zapisu danych uczestnika: " + uErr.message);
      }
    }

    const { error: nErr } = await supabase
      .from("payments")
      .update({ notes: (req.body.notes || "").trim() || null })
      .eq("id", payment.id);
    if (nErr) throw new Error("Błąd zapisu notatek: " + nErr.message);

    res.redirect(
      `${back}?success=${encodeURIComponent(
        "Zapisano zmiany." +
          (emailChanged
            ? " UWAGA: zmieniłeś e-mail — to login do panelu uczestnika."
            : "")
      )}`
    );
  } catch (err) {
    res.redirect(`${back}?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;