const express = require("express");
const MarkdownIt = require("markdown-it");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");
const speakeasy = require("speakeasy");
const { initializeAdmins } = require("./config/admins");
const authRoutes = require("./routes/auth");
const { fetchCompany, fetchHelpPage, fetchActiveCourse } = require("./config/datocms");
const { ICONS } = require('./config/icons');

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const MAIN_SITE_URL = "https://ceea.org.pl";


// === SUPABASE ===
let supabase;
try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      realtime: { transport: WebSocket },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
  console.log("✅ Supabase OK");
} catch (error) {
  console.error("❌ Supabase error:", error.message);
  process.exit(1);
}

const app = express();
app.use(cookieParser());

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

// ===== ROUTING PO ŚCIEŻCE (zamiast domeny) =====
const ADMIN_PREFIX = "/ceea-poznan-admin";

app.use((req, res, next) => {
  // Sprawdź czy ścieżka zaczyna się od prefixu admina
  req.isAdminPath = req.path.startsWith(ADMIN_PREFIX);
  next();
});

// ===== INICJALIZACJA TOTP ADMINÓW =====
app.locals.admins = new Map();
app.locals.sessions = new Map();

initializeAdmins()
  .then((admins) => {
    app.locals.admins = admins;
    console.log("Admini TOTP zainicjalizowani:", admins.size);
  })
  .catch((err) => {
    console.error("❌ Błąd inicjalizacji adminów:", err.message);
  });

app.use("/api/auth", authRoutes);

// ===== MIDDLEWARE =====

const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect("/");
};

const requireAdmin = (req, res, next) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;

  const session = app.locals.sessions.get(token);

  if (session && session.expires > Date.now()) {
    req.admin = app.locals.admins.get(session.email);
    req.session.isAdmin = true;
    return next();
  }

  res.redirect(ADMIN_PREFIX + "/");
};

// Middleware blokujące dostęp z złej ścieżki
const adminOnly = (req, res, next) => {
  if (!req.isAdminPath) {
    return res.redirect("https://ceea.org.pl/");
  }
  next();
};

const userOnly = (req, res, next) => {
  if (req.isAdminPath) {
    return res.redirect("https://ceea.org.pl/");
  }
  next();
};



// ===== PANEL ADMINISTRATORA — /ceea-poznan-admin/ =====

// Admin login
app.get(ADMIN_PREFIX + "/", adminOnly, (req, res) => {
  res.render("admin-login", { error: null, year: new Date().getFullYear() });
});

app.get(ADMIN_PREFIX + "/wyloguj", adminOnly, (req, res) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;
  app.locals.sessions.delete(token);
  req.session.isAdmin = false;
  res.redirect(ADMIN_PREFIX + "/");
});

app.get(ADMIN_PREFIX + "/kursy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: courses, error } = await supabase
      .from("courses")
      .select("*")
      .order("name");

    if (error) {
      console.error("Błąd Supabase (kursy):", error);
      return res.render("admin-kursy", {
        isAdmin: true,
        courses: [],
        error: error.message,
      });
    }

    res.render("admin-kursy", { isAdmin: true, courses: courses || [] });
  } catch (err) {
    console.error("Błąd serwera (kursy):", err);
    res.status(500).render("error", { message: "Błąd pobierania kursów" });
  }
});

app.post(ADMIN_PREFIX + "/kursy", adminOnly, requireAdmin, async (req, res) => {
  const { name, description } = req.body;

  try {
    const { data, error } = await supabase
      .from("courses")
      .insert([{ name, description }])
      .select();

    if (error) {
      console.error("BŁĄD SUPABASE (dodawanie kursu):", error);
      return res.render("admin-kursy", {
        isAdmin: true,
        courses: [],
        error: error.message,
      });
    }

    res.redirect(ADMIN_PREFIX + "/kursy");
  } catch (err) {
    console.error("Błąd serwera (dodawanie kursu):", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});

app.get(
  ADMIN_PREFIX + "/kursy/:id/materials",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .eq("id", req.params.id)
        .single();

      if (courseError) {
        console.error("Błąd pobierania kursu:", courseError);
        return res.redirect(ADMIN_PREFIX + "/kursy");
      }

      const { data: materials, error: materialsError } = await supabase
        .from("materials")
        .select("*")
        .eq("course_id", req.params.id)
        .order("order");

      if (materialsError) {
        console.error("Błąd pobierania materiałów:", materialsError);
      }

      res.render("admin-materials", {
        isAdmin: true,
        course,
        materials: materials || [],
      });
    } catch (err) {
      console.error("Błąd serwera (materiały):", err);
      res.redirect(ADMIN_PREFIX + "/kursy");
    }
  }
);

app.post(
  ADMIN_PREFIX + "/kursy/:id/materials",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    const { title, type, url, order } = req.body;

    try {
      const { error } = await supabase.from("materials").insert([
        {
          course_id: req.params.id,
          title,
          type,
          url,
          order: parseInt(order) || 1,
        },
      ]);

      if (error) {
        console.error("Błąd dodawania materiału:", error);
      }

      res.redirect(ADMIN_PREFIX + `/kursy/${req.params.id}/materials`);
    } catch (err) {
      console.error("Błąd serwera (dodawanie materiału):", err);
      res.redirect(ADMIN_PREFIX + `/kursy/${req.params.id}/materials`);
    }
  }
);

app.post(
  ADMIN_PREFIX + "/materials/:id/delete",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: material, error: fetchError } = await supabase
        .from("materials")
        .select("course_id")
        .eq("id", req.params.id)
        .single();

      if (fetchError) {
        console.error("Błąd pobierania materiału:", fetchError);
        return res.redirect(ADMIN_PREFIX + "/kursy");
      }

      const { error: deleteError } = await supabase
        .from("materials")
        .delete()
        .eq("id", req.params.id);

      if (deleteError) {
        console.error("Błąd usuwania materiału:", deleteError);
      }

      res.redirect(ADMIN_PREFIX + `/kursy/${material.course_id}/materials`);
    } catch (err) {
      console.error("Błąd serwera (usuwanie materiału):", err);
      res.redirect(ADMIN_PREFIX + "/kursy");
    }
  }
);

app.get(
  ADMIN_PREFIX + "/kursy/:id/uczestnicy",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    try {
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .eq("id", req.params.id)
        .single();

      if (courseError) {
        console.error("Błąd pobierania kursu:", courseError);
        return res.redirect(ADMIN_PREFIX + "/kursy");
      }

      const { data: enrollments, error: enrollmentsError } = await supabase
        .from("enrollments")
        .select("*")
        .eq("course_id", req.params.id);

      if (enrollmentsError) {
        console.error("Błąd pobierania uczestników:", enrollmentsError);
      }

      res.render("admin-uczestnicy", {
        isAdmin: true,
        course,
        enrollments: enrollments || [],
      });
    } catch (err) {
      console.error("Błąd serwera (uczestnicy):", err);
      res.redirect(ADMIN_PREFIX + "/kursy");
    }
  }
);

app.post(
  ADMIN_PREFIX + "/kursy/:id/uczestnicy",
  adminOnly,
  requireAdmin,
  async (req, res) => {
    const { email } = req.body;

    try {
      const { error } = await supabase.from("enrollments").insert([
        {
          course_id: req.params.id,
          email,
          status: "active",
        },
      ]);

      if (error) {
        console.error("Błąd dodawania uczestnika:", error);
      }

      res.redirect(ADMIN_PREFIX + `/kursy/${req.params.id}/uczestnicy`);
    } catch (err) {
      console.error("Błąd serwera (dodawanie uczestnika):", err);
      res.redirect(ADMIN_PREFIX + `/kursy/${req.params.id}/uczestnicy`);
    }
  }
);

// ===== PANEL UCZESTNIKA — / (root) =====

app.get("/", userOnly, async (req, res) => {
  if (req.session.user) return res.redirect("/kursy");
  const course = await fetchActiveCourse();
  res.render("login", {
    title: "Logowanie — CEEA",
    error: null,
    message: null,
    registrationUrl: course
      ? `${MAIN_SITE_URL}/kursy/${course.year}/${course.slug}/rejestracja`
      : null,
  });
});

app.post("/login", userOnly, async (req, res) => {
  const { email } = req.body;

  try {
    const { data: enrollments, error: enrollmentsError } = await supabase
      .from("enrollments")
      .select("id")
      .eq("email", email)
      .eq("status", "active")
      .limit(1);

    if (enrollmentsError) {
      console.error("Błąd sprawdzania zapisu:", enrollmentsError);
    }

    if (!enrollments?.length) {
      return res.render("login", {
        error: "Ten email nie jest zapisany na kurs.",
        message: null,
      });
    }

    const { error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: email,
      options: { redirectTo: "https://panel.ceea.org.pl/auth/callback" },
    });

    if (error) {
      console.error("Błąd wysyłania magic link:", error);
      return res.render("login", {
        error: "Błąd wysyłania. Spróbuj ponownie.",
        message: null,
      });
    }

    res.render("login", {
      error: null,
      message: "Sprawdź email z linkiem logowania!",
    });
  } catch (err) {
    console.error("Błąd serwera (login):", err);
    res.render("login", {
      error: "Wystąpił błąd serwera. Spróbuj ponownie.",
      message: null,
    });
  }
});

app.get("/auth/callback", userOnly, async (req, res) => {
  const { token_hash } = req.query;

  if (!token_hash) {
    return res.render("login", {
      error: "Brak tokenu w linku.",
      message: null,
    });
  }

  try {
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash,
      type: "magiclink",
    });

    if (error) {
      console.error("Błąd weryfikacji OTP:", error);
      return res.render("login", {
        error: "Link wygasł lub jest nieprawidłowy.",
        message: null,
      });
    }

    req.session.user = {
      id: data.user.id,
      email: data.user.email,
    };

    res.redirect("/kursy");
  } catch (err) {
    console.error("Błąd serwera (callback):", err);
    res.render("login", {
      error: "Wystąpił błąd serwera.",
      message: null,
    });
  }
});

app.get("/kursy", userOnly, requireAuth, async (req, res) => {
  try {
    const { data: enrollments, error } = await supabase
      .from("enrollments")
      .select(
        `
        courses (
          id,
          name,
          description,
          materials (
            title,
            type,
            url,
            order_num
          )
        )
      `
      )
      .eq("email", req.session.user.email)
      .eq("status", "active");

    if (error) {
      console.error("Błąd pobierania kursów użytkownika:", error);
    }

    res.render("dashboard", {
      title: "Moje kursy — CEEA",
      user: req.session.user,
      courses: enrollments?.map((e) => e.courses) || [],
    });
  } catch (err) {
    console.error("Błąd serwera (dashboard):", err);
    res.render("dashboard", {
      title: "Moje kursy — CEEA",
      user: req.session.user,
      courses: [],
    });
  }
});

app.get("/logout", userOnly, (req, res) => {
  req.session.destroy();
  res.redirect("/");
});



const CALLOUT_ICONS = { info: "ℹ️", warning: "⚠️", danger: "🚨" };
const DEFAULT_ICON = `<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>`;

function renderAnswer(q) {
  const answerHtml = md.render(q.answer || "");
  const c = q.callout;
  if (!c) return answerHtml;
  const icon = CALLOUT_ICONS[c.kind] || CALLOUT_ICONS.info;
  const html = md.renderInline(c.content || "");
  return (
    answerHtml +
    `<div class="callout callout-${c.kind}"><span>${icon}</span><div>${html}</div></div>`
  );
}

// ===== STRONA POMOCY =====
app.get("/pomoc", async (req, res) => {
  try {
    const [company, help] = await Promise.all([fetchCompany(), fetchHelpPage()]);
    const questionsByCategory = {};
    (help?.questions || []).forEach((q) => {
      const catId = q.category?.id || "uncategorized";
      (questionsByCategory[catId] ||= []).push({
        question: q.question,
        answer: renderAnswer(q),
      });
    });

    const categories = (help?.categories || []).map((cat) => ({
      id: cat.slug || cat.id,
      slug: cat.slug || cat.id,
      title: cat.title,
      description: cat.description,
      icon: ICONS[cat.icon] || DEFAULT_ICON,  // "settings" → SVG z icons.js
      questions: questionsByCategory[cat.id] || [],
    }));
    console.log(categories)

    res.render("help/index", {
      title: help?.page?.title || "Centrum Pomocy — CEEA Panel",
      company,
      page: help?.page,
      categories,
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    console.error("⚠️ /pomoc error:", err.message);
    res.status(500).render("error", { message: "Błąd ładowania centrum pomocy" });
  }
});

// ===== POLITYKA PRYWATNOŚCI =====
app.get("/polityka-prywatnosci", async (req, res) => {
  try {
    const [company, privacyPage] = await Promise.all([
      fetchCompany(),
      // fetchPrivacyPage()
    ]);

    res.render("privacy/index", {
      title: privacyPage?.title || "Polityka Prywatności — CEEA Panel",
      company,
      page: privacyPage,
      lastUpdated: privacyPage?.lastUpdated || new Date().toISOString(),
    });
  } catch (err) {
    console.error("Błąd ładowania polityki prywatności:", err);
    res
      .status(500)
      .render("error", { message: "Błąd ładowania polityki prywatności" });
  }
});

// ===== REGULAMIN =====
app.get("/regulamin", async (req, res) => {
  try {
    const [company, termsPage] = await Promise.all([
      fetchCompany(),
      // fetchTermsPage()  // odkomentuj, gdy dodasz model w DatoCMS
    ]);

    res.render("terms/index", {
      title: termsPage?.title || "Regulamin — CEEA Panel",
      company,
      page: termsPage,
      lastUpdated: termsPage?.lastUpdated || new Date().toISOString(),
    });
  } catch (err) {
    console.error("Błąd ładowania regulaminu:", err);
    res
      .status(500)
      .render("error", { message: "Błąd ładowania regulaminu" });
  }
});


// ===== START =====
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Panel działa na http://localhost:${PORT}`);
    console.log(`📅 Data uruchomienia: ${new Date().toISOString()}`);
  });
} else {
  module.exports = app;
}
