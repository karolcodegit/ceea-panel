const express = require("express");
const router = express.Router();
const supabase = require("../config/supabase");
const { ADMIN_PREFIX, requireAdmin, adminOnly } = require("../middleware/auth");
const adminModules = require("../config/admin-modules");
const adminIcon = require("../config/admin-icons");
const secrets = require("../services/secrets");
const { getFlags, setFlag } = require("../services/flags");

// ── Kontekst wspólny dla całego panelu (moduły montowane NIŻEJ też go dostają,
//    bo przechodzą przez ten middleware przed własnymi route'ami) ──
router.use((req, res, next) => {
  res.locals.adminPrefix = ADMIN_PREFIX;
  res.locals.adminModules = adminModules;
  res.locals.adminIcon = adminIcon;

  const token = req.cookies?.adminToken;
  const session = req.app.locals.sessions.get(token);
  if (session && session.expires > Date.now()) {
    res.locals.adminUser = req.app.locals.admins.get(session.email);
  } else {
    res.locals.adminUser = null;
  }

  next();
});

// ===== PULPIT (lub login, gdy niezalogowany) =====
router.get("/", adminOnly, async (req, res) => {
  const token = req.cookies?.adminToken;
  const logged = token && req.app.locals.sessions.has(token);
  if (!logged) {
    return res.render("admin-login", {
      error: null,
      year: new Date().getFullYear(),
      adminPrefix: ADMIN_PREFIX,
    });
  }

  // ── Struktura danych dashboardu (kategorie → partials) ──
  const dash = {
    courses: { total: 0, enrollments: 0, activeParticipants: 0, activeTitle: null, revenue: 0 },
    books:   { titles: 0, soldUnits: 0, revenue: 0, awaiting: 0, lowStock: 0, ordersSeries: [], top: [], lowList: [], recentOrders: [] },
    mails:   { sent30: 0, failed30: 0, queued: 0, recent: [] },
    visits:  { today: 0, week: 0, month: 0 },
    series:  [],
    topPages: [],
    activity: [],
    usersTotal: 0,
    infra: [],
  };

  try {
    const monthAgo = new Date(Date.now() - 30 * 864e5);

    // ── KURSY ──
    const { data: courses } = await supabase.from("courses").select("course_id, title, available, is_archive");
    const { count: enrollCount } = await supabase.from("enrollments").select("id", { count: "exact", head: true });
    const { data: activeCourse } = await supabase.from("courses").select("course_id, title").eq("is_active", true).maybeSingle();
    const { count: activePart } = activeCourse
      ? await supabase.from("enrollments").select("id", { count: "exact", head: true }).eq("course_id", activeCourse.course_id)
      : { count: 0 };
    const { data: paidPayments } = await supabase.from("payments").select("amount").eq("status", "paid").gte("created_at", monthAgo.toISOString());

    dash.courses.total = (courses || []).length;
    dash.courses.enrollments = enrollCount || 0;
    dash.courses.activeParticipants = activePart || 0;
    dash.courses.activeTitle = activeCourse?.title || null;
    dash.courses.revenue = (paidPayments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);

    // ── UŻYTKOWNICY ──
    const { count: usersCount } = await supabase.from("users").select("id", { count: "exact", head: true });
    dash.usersTotal = usersCount || 0;

    // ── KSIĄŻKI ──
    // UWAGA: jeśli Twoja tabela książek nazywa się inaczej (np. "products"), zmień poniżej.
    const { data: bookRows } = await supabase.from("books").select("id, name, stock_quantity");
    const { data: bookOrders } = await supabase.from("book_orders").select("id, order_number, email, amount, status, items, created_at").order("created_at", { ascending: false }).limit(5);
    const { data: paidBookOrders } = await supabase.from("book_orders").select("amount, items, status").eq("status", "paid");
    const { count: awaitingBookOrders } = await supabase.from("book_orders").select("id", { count: "exact", head: true }).in("status", ["new", "awaiting_payment", "awaiting_transfer"]);

    const qty = (items) => (Array.isArray(items) ? items : []).reduce((s, i) => s + (Number(i.qty || i.quantity) || 1), 0);
    dash.books.titles = (bookRows || []).length;
    dash.books.soldUnits = (paidBookOrders || []).reduce((s, o) => s + qty(o.items), 0);
    dash.books.revenue = (paidBookOrders || []).reduce((s, o) => s + (Number(o.amount) || 0), 0);
    dash.books.awaiting = awaitingBookOrders || 0;
    dash.books.lowStock = (bookRows || []).filter(b => Number(b.stock_quantity) <= 5).length;
    dash.books.recentOrders = bookOrders || [];

    // wykres zamówień książek — 14 dni
    const { data: bookOrders14 } = await supabase.from("book_orders")
      .select("created_at").gte("created_at", new Date(Date.now() - 14 * 864e5).toISOString());
    const boAll = bookOrders14 || [];
    const nowBooks = new Date();
    for (let i = 13; i >= 0; i--) {
      const d0 = new Date(nowBooks); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - i);
      const d1 = new Date(d0.getTime() + 864e5);
      dash.books.ordersSeries.push({
        label: `${d0.getDate()}.${d0.getMonth() + 1}`,
        count: boAll.filter(o => { const t = new Date(o.created_at); return t >= d0 && t < d1; }).length,
      });
    }

    // top sprzedawane książki (z opłaconych zamówień)
    const topMap = {};
    (paidBookOrders || []).forEach(o => (Array.isArray(o.items) ? o.items : []).forEach(it => {
      const t = it.title || it.name || 'Inne';
      topMap[t] = (topMap[t] || 0) + (Number(it.qty || it.quantity) || 1);
    }));
    dash.books.top = Object.entries(topMap).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([title, count]) => ({ title, count }));

    // niski stan magazynowy (lista z nazwami)
    const { data: lowBooks } = await supabase.from("books")
      .select("name, stock_quantity").order("stock_quantity", { ascending: true }).limit(5);
    dash.books.lowList = (lowBooks || []).filter(b => Number(b.stock_quantity) <= 5);

    // ── MAILE (lokalne logi; w przyszłości: sync MailerSend activity) ──
    const { count: sentMails } = await supabase.from("mail_logs").select("id", { count: "exact", head: true }).eq("status", "sent").gte("created_at", monthAgo.toISOString());
    const { count: failedMails } = await supabase.from("mail_logs").select("id", { count: "exact", head: true }).eq("status", "failed").gte("created_at", monthAgo.toISOString());
    const { count: queuedMails } = await supabase.from("mail_queue").select("id", { count: "exact", head: true });
    dash.mails.sent30 = sentMails || 0;
    dash.mails.failed30 = failedMails || 0;
    dash.mails.queued = queuedMails || 0;
    const { data: recentMails } = await supabase.from("mail_logs")
      .select("recipient_email, status, created_at").order("created_at", { ascending: false }).limit(8);
    dash.mails.recent = recentMails || [];

    // ── ODWIEDZINY ──
    const { data: views } = await supabase.from("page_views").select("path, created_at").gte("created_at", monthAgo.toISOString());
    const all = views || [];
    const now = new Date();
    const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
    const weekAgo = new Date(now.getTime() - 7 * 864e5);
    dash.visits.month = all.length;
    dash.visits.week = all.filter(v => new Date(v.created_at) >= weekAgo).length;
    dash.visits.today = all.filter(v => new Date(v.created_at) >= startToday).length;
    for (let i = 13; i >= 0; i--) {
      const d0 = new Date(now); d0.setHours(0, 0, 0, 0); d0.setDate(d0.getDate() - i);
      const d1 = new Date(d0.getTime() + 864e5);
      dash.series.push({
        label: `${d0.getDate()}.${d0.getMonth() + 1}`,
        count: all.filter(v => { const t = new Date(v.created_at); return t >= d0 && t < d1; }).length,
      });
    }
    const byPath = {};
    all.forEach(v => { byPath[v.path] = (byPath[v.path] || 0) + 1; });
    dash.topPages = Object.entries(byPath).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([path, count]) => ({ path, count }));

    // ── OSTATNIA AKTYWNOŚĆ ──
    const { data: recentEnroll } = await supabase.from("enrollments").select("created_at, users(email, name, surname), courses(title)").order("created_at", { ascending: false }).limit(5);
    const { data: recentPay } = await supabase.from("payments").select("created_at, amount, status, users(email)").order("created_at", { ascending: false }).limit(5);
    const acts = [
      ...(recentEnroll || []).map(e => ({ date: e.created_at, icon: "🎓", label: `Zapis: ${e.users?.name || ""} ${e.users?.surname || ""}`.trim(), sub: e.courses?.title || "", href: ADMIN_PREFIX + "/kursy" })),
      ...(dash.books.recentOrders || []).map(o => ({ date: o.created_at, icon: "📚", label: `Zamówienie książek: ${o.order_number || o.email}`, sub: `${qty(o.items)} szt · ${Number(o.amount).toFixed(2)} zł`, href: ADMIN_PREFIX + "/platnosci" })),
      ...(recentPay || []).map(p => ({ date: p.created_at, icon: "💳", label: `Płatność: ${Number(p.amount).toFixed(2)} zł (${p.status})`, sub: p.users?.email || "", href: ADMIN_PREFIX + "/platnosci" })),
    ];
    dash.activity = acts.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10);

    // ── INFRASTRUKTURA ──
    let sbOk = false;
    try {
      const { error } = await supabase.from("users").select("id", { count: "exact", head: true });
      sbOk = !error;
    } catch (e) {}
    dash.infra = [
      { name: "Supabase", ok: sbOk, desc: "Baza danych" },
      { name: "MailerSend", ok: !!(process.env.MAILERSEND_API_KEY || process.env.MAILERSEND_TOKEN), desc: "Wysyłka e-maili" },
      { name: "ZeptoMail", ok: !!process.env.ZEPTOMAIL_API_KEY, desc: "Wysyłka (backup)" },
      { name: "Cloudinary", ok: !!(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET), desc: "Pliki i media" },
      { name: "InPost ShipX", ok: !!(process.env.INPOST_API_TOKEN && process.env.INPOST_ORG_ID), desc: process.env.INPOST_ENV === "production" ? "Wysyłki (produkcja)" : "Wysyłki (sandbox)" },
      { name: "Google Cloud Run", ok: !!process.env.CEEA_API_URL, desc: "Rejestracja + płatności" },
      { name: "Northflank", ok: true, desc: "Hosting panelu" },
      { name: "Netlify", ok: true, desc: "Hosting strony (Gatsby)" },
    ];
  } catch (err) {
    console.error("pulpit:", err);
  }

  res.render("admin-dashboard", {
    isAdmin: true,
    active: "home",
    dash
  });
});

// ===== USTAWIENIA ADMINA =====
const keyTargets = {
  github: process.env.GITHUB_REPO
    ? `https://github.com/${process.env.GITHUB_REPO}/settings/secrets/actions`
    : null,
  northflank:
    process.env.NF_ENV_URL ||
    (process.env.NF_PROJECT && process.env.NF_SERVICE
      ? `https://app.northflank.com/application/${process.env.NF_PROJECT}/${process.env.NF_SERVICE}/environment`
      : null),
  netlify: process.env.NETLIFY_SITE
    ? `https://app.netlify.com/sites/${process.env.NETLIFY_SITE}/configuration/env`
    : null,
  nodejs: "local", // podpowiedź: .env w Northflank
  gatsby: "gatsby", // podpowiedź: zmienne GATSBY_* w Netlify
};

router.get("/ustawienia", adminOnly, requireAdmin, async (req, res) => {
  const status = {
    supabase: false,
    cloudinary: false,
    mailer: false,
  };
  let company = null;
  try {
    const { data: companyRow } = await supabase
      .from("company_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    company = companyRow;
  } catch (e) {
    console.error("ustawienia/firma:", e.message);
  }

  try {
    const [u, e, m] = await Promise.all([
      supabase.from("users").select("id", { count: "exact", head: true }),
      supabase.from("enrollments").select("id", { count: "exact", head: true }),
      supabase.from("materials").select("id", { count: "exact", head: true }),
    ]);
    if (!u.error && !e.error && !m.error) status.supabase = true;
  } catch (err) {
    console.error("ustawienia/supabase:", err.message);
  }

  status.cloudinary = !!(
    process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_UPLOAD_PRESET
  );
  status.mailer = !!(
    process.env.MAILERSEND_API_KEY || process.env.MAILERSEND_TOKEN
  );

  // UWAGA: bez try/catch błąd w listKeys() (brak tabeli admin_api_keys,
  // zły SECRETS_ENCRYPTION_KEY → decrypt rzuca) = unhandled rejection
  // w async route → Express 4 ubija proces → "upstream connect error".
  let keys = [];
  try {
    keys = res.locals.adminUser?.isSuper ? await listKeys() : [];
  } catch (err) {
    console.error("ustawienia/klucze:", err.message);
  }

  res.render("admin-ustawienia", {
    isAdmin: true,
    active: "ustawienia",
    status,
    company,
    keys,
    isSuperUser: !!res.locals.adminUser?.isSuper,
    query: req.query,
    keyTargets,
  });
});

router.get("/ustawienia/eksport", adminOnly, requireAdmin, async (req, res) => {
  try {
    const [{ data: users }, { data: enrollments }, { data: materials }] =
      await Promise.all([
        supabase
          .from("users")
          .select("id, email, name, surname, phone, created_at"),
        supabase.from("enrollments").select("*"),
        supabase.from("materials").select("*"),
      ]);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ceea-backup-${stamp}.json"`
    );
    res.send(
      JSON.stringify(
        { exportedAt: new Date().toISOString(), users, enrollments, materials },
        null,
        2
      )
    );
  } catch (err) {
    console.error("ustawienia/eksport:", err);
    res.redirect(ADMIN_PREFIX + "/ustawienia");
  }
});

// ===== PROFIL =====
router.get("/profil", adminOnly, async (req, res) => {
  try {
    const email = res.locals.adminUser?.email;
    if (!email) return res.redirect(ADMIN_PREFIX + "/");
    const { data: profile } = await supabase
      .from("admin_users")
      .select(
        "email, name, is_super, qr_setup, backup_codes, created_at, last_login, avatar_url, bio, phone, position"
      )
      .eq("email", email)
      .single();
    res.render("admin-profil", {
      isAdmin: true,
      active: "profil",
      profile,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      uploadPreset: process.env.CLOUDINARY_UPLOAD_PRESET,
      query: req.query,
    });
  } catch (err) {
    console.error("[GET /profil]", err);
    res.redirect(ADMIN_PREFIX + "/");
  }
});

// Zapis profilu (imię, telefon, stanowisko, opis, zdjęcie)
router.post("/profil", adminOnly, async (req, res) => {
  try {
    const email = res.locals.adminUser?.email;
    if (!email) return res.redirect(ADMIN_PREFIX + "/");
    const clean = (v, max = 500) => (v || "").toString().trim().slice(0, max);
    const updates = {
      name: clean(req.body.name, 100),
      phone: clean(req.body.phone, 30),
      position: clean(req.body.position, 100),
      bio: clean(req.body.bio, 2000),
      avatar_url: clean(req.body.avatar_url, 500),
      updated_at: new Date().toISOString(),
    };
    if (!updates.name) delete updates.name;
    await supabase.from("admin_users").update(updates).eq("email", email);
    const a = req.app.locals.admins.get(email);
    if (a) {
      if (updates.name) a.name = updates.name;
      a.avatar_url = updates.avatar_url;
      a.position = updates.position;
    }
    res.redirect(
      ADMIN_PREFIX + "/profil?success=" + encodeURIComponent("Zapisano zmiany")
    );
  } catch (err) {
    res.redirect(
      ADMIN_PREFIX + "/profil?error=" + encodeURIComponent(err.message)
    );
  }
});

// KLUCZE API — rejestr w Ustawieniach (tylko super admin)

function superOnly(req, res, next) {
  if (res.locals.adminUser?.isSuper) return next();
  return res.redirect(
    ADMIN_PREFIX +
      "/ustawienia?error=" +
      encodeURIComponent("Sekcja Klucze dostępna tylko dla super admina.")
  );
}

// Lista kluczy (do GET /ustawienia)
async function listKeys() {
  const { data } = await supabase
    .from("admin_api_keys")
    .select(
      "id, service, key_name, alias, targets, value_enc, expires_at, last_used_at, created_at, updated_at"
    )
    .order("service", { ascending: true })
    .order("key_name", { ascending: true });
  return (data || []).map((k) => ({
    ...k,
    masked: secrets.mask(k.value_enc ? secrets.decrypt(k.value_enc) : ""),
  }));
}

router.post(
  "/ustawienia/klucze",
  adminOnly,
  requireAdmin,
  superOnly,
  async (req, res) => {
    try {
      if (!secrets.isConfigured())
        throw new Error(
          "Brak SECRETS_ENCRYPTION_KEY w env — klucz nie został zapisany."
        );
      const clean = (v, max = 300) => (v || "").toString().trim().slice(0, max);
      const service = clean(req.body.service, 40);
      const keyName = clean(req.body.key_name, 120)
        .toUpperCase()
        .replace(/\s+/g, "_");
      const value = req.body.value || "";
      if (!service || !keyName || !value)
        throw new Error("Uzupełnij usługę, nazwę i wartość klucza.");

      await supabase.from("admin_api_keys").insert({
        service,
        key_name: keyName,
        value_enc: secrets.encrypt(value),
        expires_at: req.body.expires_at || null,
        created_by: res.locals.adminUser?.email,
        targets: Array.isArray(req.body.targets)
          ? req.body.targets
          : req.body.targets
          ? [req.body.targets]
          : [],
        alias:
          clean(req.body.alias, 120).toUpperCase().replace(/\s+/g, "_") || null,
      });
      res.redirect(
        ADMIN_PREFIX +
          "/ustawienia?success=" +
          encodeURIComponent("Dodano klucz " + keyName)
      );
    } catch (err) {
      res.redirect(
        ADMIN_PREFIX + "/ustawienia?error=" + encodeURIComponent(err.message)
      );
    }
  }
);

router.post(
  "/ustawienia/klucze/:id/usun",
  adminOnly,
  requireAdmin,
  superOnly,
  async (req, res) => {
    try {
      const { data } = await supabase
        .from("admin_api_keys")
        .select("key_name")
        .eq("id", req.params.id)
        .single();
      await supabase.from("admin_api_keys").delete().eq("id", req.params.id);
      res.redirect(
        ADMIN_PREFIX +
          "/ustawienia?success=" +
          encodeURIComponent("Usunięto klucz " + (data?.key_name || ""))
      );
    } catch (err) {
      res.redirect(
        ADMIN_PREFIX + "/ustawienia?error=" + encodeURIComponent(err.message)
      );
    }
  }
);

// Odsłonięcie wartości (AJAX) + odnotowanie użycia
router.get(
  "/ustawienia/klucze/:id/wartosc",
  adminOnly,
  requireAdmin,
  superOnly,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from("admin_api_keys")
        .select("*")
        .eq("id", req.params.id)
        .single();
      if (error || !data) throw new Error("Nie znaleziono klucza");
      await supabase
        .from("admin_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", data.id);
      res.json({ ok: true, value: secrets.decrypt(data.value_enc) });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

// Import wielu kluczy z wklejonego .env (JSON z frontu)
router.post(
  "/ustawienia/klucze/import",
  adminOnly,
  requireAdmin,
  superOnly,
  async (req, res) => {
    try {
      if (!secrets.isConfigured())
        throw new Error("Brak SECRETS_ENCRYPTION_KEY w env.");
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      if (!items.length) throw new Error("Brak danych do importu.");

      const cleanName = (v) =>
        (v || "")
          .toString()
          .trim()
          .toUpperCase()
          .replace(/\s+/g, "_")
          .slice(0, 120);
      const rows = [];
      for (const it of items) {
        const name = cleanName(it.name);
        const value = (it.value || "").toString().trim();
        if (!name || !value || !/^[A-Z][A-Z0-9_]*$/.test(name)) continue;
        rows.push({
          service: "nodejs",
          key_name: name,
          value_enc: secrets.encrypt(value),
          targets: ["nodejs"],
          created_by: res.locals.adminUser?.email,
        });
      }
      if (!rows.length)
        throw new Error("Nie rozpoznano żadnych linii KEY=VALUE.");

      // pomijamy już istniejące nazwy
      const { data: existing } = await supabase
        .from("admin_api_keys")
        .select("key_name");
      const have = new Set((existing || []).map((k) => k.key_name));
      const fresh = rows.filter((r) => !have.has(r.key_name));

      if (fresh.length) await supabase.from("admin_api_keys").insert(fresh);
      res.json({
        ok: true,
        added: fresh.length,
        skipped: rows.length - fresh.length,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  }
);

// Edycja klucza (wartość opcjonalna — pusta = bez zmian)
router.post(
  "/ustawienia/klucze/:id/edytuj",
  adminOnly,
  requireAdmin,
  superOnly,
  async (req, res) => {
    try {
      const clean = (v, max = 300) => (v || "").toString().trim().slice(0, max);
      const updates = {
        service: clean(req.body.service, 40),
        key_name: clean(req.body.key_name, 120)
          .toUpperCase()
          .replace(/\s+/g, "_"),
        alias:
          clean(req.body.alias, 120).toUpperCase().replace(/\s+/g, "_") || null,
        expires_at: req.body.expires_at || null,
        targets: Array.isArray(req.body.targets)
          ? req.body.targets
          : req.body.targets
          ? [req.body.targets]
          : [],
        updated_at: new Date().toISOString(),
      };
      const value = (req.body.value || "").toString();
      if (value) {
        if (!secrets.isConfigured())
          throw new Error("Brak SECRETS_ENCRYPTION_KEY w env.");
        updates.value_enc = secrets.encrypt(value);
      }
      const { error } = await supabase
        .from("admin_api_keys")
        .update(updates)
        .eq("id", req.params.id);
      if (error) throw error;
      res.redirect(
        ADMIN_PREFIX +
          "/ustawienia?success=" +
          encodeURIComponent("Zapisano zmiany klucza " + updates.key_name)
      );
    } catch (err) {
      res.redirect(
        ADMIN_PREFIX + "/ustawienia?error=" + encodeURIComponent(err.message)
      );
    }
  }
);

// ===== WYLOGOWANIE =====
router.get("/wyloguj", adminOnly, (req, res) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;
  req.app.locals.sessions.delete(token);
  req.session.isAdmin = false;
  res.redirect(ADMIN_PREFIX + "/");
});

// ═══════════════════════════════════════════════════════════════
// ===== MODUŁY (każdy własny plik w routes/) =====
// ═══════════════════════════════════════════════════════════════
router.use("/", require("./kursy")); // kursy, materiały, uczestnicy
router.use("/", require("./maile")); // moduł mailowy + API
router.use("/", require("./platnosci")); // płatności, faktury PDF, mark-paid
router.use("/", require("./admini")); // administratorzy + 2FA
router.use("/", require("./notifications")); // powiadomienia API
router.use("/", require("./faktury")); // kto potrzebuje faktury (Twój plik)
router.use("/", require("./ksiazki")); // lista ksiązek
router.use("/", require("./sponsorzy")); // wszyscy sponsorzy
router.use("/", require("./faq")); // pytania i odpowiedzi
router.use("/", require("./pracownicy")); // Pracownicy zarządzający organizacją
router.use("/", require("./firma")); // Dane firmy CEEA Poznań
router.use("/", require("./media")); // Galeria z Cloudinary
router.use("/", require("./serwis").router); //Tryb serwisowy


module.exports = router;