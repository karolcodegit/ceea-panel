const express = require("express");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");
const speakeasy = require("speakeasy");
const { initializeAdmins } = require("./config/admins");
const authRoutes = require("./routes/auth");

// === Ładujemy dotenv TYLKO lokalnie (na Railway nie jest potrzebne) ===
// WAŻNE: To musi być NA POCZĄTKU, zanim sprawdzimy zmienne
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config();
}

// === DEBUG ZMIENNYCH ŚRODOWISKOWYCH ===
console.log("=== ENV DEBUG (na starcie) ===");
console.log("NODE_ENV:", process.env.NODE_ENV || "undefined");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "✅ PRESENT (length: " + process.env.SUPABASE_URL.length + ")" : "❌ MISSING");
console.log("SUPABASE_SERVICE_KEY:", process.env.SUPABASE_SERVICE_KEY ? "✅ PRESENT (length: " + process.env.SUPABASE_SERVICE_KEY.length + ")" : "❌ MISSING");
console.log("SESSION_SECRET:", process.env.SESSION_SECRET ? "✅ PRESENT" : "❌ MISSING");
console.log("PORT:", process.env.PORT || "3000 (default)");
console.log("============================");

// === WALIDACJA ZMIENNYCH ===
if (!process.env.SUPABASE_URL) {
  console.error("❌ BŁĄD KRYTYCZNY: SUPABASE_URL jest wymagane!");
  console.error("Upewnij się, że zmienna jest ustawiona w Railway i zrób redeploy.");
  process.exit(1);
}

if (!process.env.SUPABASE_SERVICE_KEY) {
  console.error("❌ BŁĄD KRYTYCZNY: SUPABASE_SERVICE_KEY jest wymagane!");
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.error("❌ BŁĄD KRYTYCZNY: SESSION_SECRET jest wymagane!");
  process.exit(1);
}

// Inicjalizacja Supabase z obsługą błędów
let supabase;
try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
      realtime: { transport: WebSocket },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
  console.log("✅ Supabase client zainicjalizowany poprawnie");
} catch (error) {
  console.error("❌ Błąd inicjalizacji Supabase:", error.message);
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

// ===== ROUTING PO DOMENIE =====
app.use((req, res, next) => {
  const host = req.headers.host;

  if (host === "ceea-admin.ceea.org.pl") {
    req.isAdminDomain = true;
  } else if (host === "panel.ceea.org.pl") {
    req.isAdminDomain = false;
  } else {
    // Lokalnie lub inna domena — domyślnie panel użytkownika
    req.isAdminDomain = false;
  }
  next();
});

// ===== INICJALIZACJA TOTP ADMINÓW =====
app.locals.admins = new Map();
app.locals.sessions = new Map();

initializeAdmins().then((admins) => {
  app.locals.admins = admins;
  console.log("Admini TOTP zainicjalizowani:", admins.size);
}).catch(err => {
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

  res.redirect("/");
};

// Middleware blokujące dostęp z złej domeny
const adminOnly = (req, res, next) => {
  if (!req.isAdminDomain) {
    return res.redirect("https://ceea.org.pl/");
  }
  next();
};

const userOnly = (req, res, next) => {
  if (req.isAdminDomain) {
    return res.redirect("https://ceea.org.pl/");
  }
  next();
};

// ===== PANEL ADMINISTRATORA (TOTP) — tylko ceea-admin.ceea.org.pl =====

app.get("/", adminOnly, (req, res) => {
  res.render("admin-login", { error: null, year: new Date().getFullYear() });
});

app.get("/wyloguj", adminOnly, (req, res) => {
  const token =
    req.headers.authorization?.replace("Bearer ", "") ||
    req.cookies?.adminToken;
  app.locals.sessions.delete(token);
  req.session.isAdmin = false;
  res.redirect("/");
});

app.get("/kursy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: courses, error } = await supabase
      .from("courses")
      .select("*")
      .order("name");

    if (error) {
      console.error("Błąd Supabase (kursy):", error);
      return res.render("admin-kursy", { isAdmin: true, courses: [], error: error.message });
    }

    res.render("admin-kursy", { isAdmin: true, courses: courses || [] });
  } catch (err) {
    console.error("Błąd serwera (kursy):", err);
    res.status(500).render("error", { message: "Błąd pobierania kursów" });
  }
});

app.post("/kursy", adminOnly, requireAdmin, async (req, res) => {
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

    res.redirect("/kursy");
  } catch (err) {
    console.error("Błąd serwera (dodawanie kursu):", err);
    res.redirect("/kursy");
  }
});

// POPRAWIONE: Ścieżka /materials (nie /materiały) — spójność z kodem
app.get("/kursy/:id/materials", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (courseError) {
      console.error("Błąd pobierania kursu:", courseError);
      return res.redirect("/kursy");
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
    res.redirect("/kursy");
  }
});

// POPRAWIONE: Ścieżka POST /materials (nie /materiały)
app.post("/kursy/:id/materials", adminOnly, requireAdmin, async (req, res) => {
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

    res.redirect(`/kursy/${req.params.id}/materials`);
  } catch (err) {
    console.error("Błąd serwera (dodawanie materiału):", err);
    res.redirect(`/kursy/${req.params.id}/materials`);
  }
});

// POPRAWIONE: Ścieżka DELETE /materials/:id (nie /materiały/:id/usuń)
app.post("/materials/:id/delete", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: material, error: fetchError } = await supabase
      .from("materials")
      .select("course_id")
      .eq("id", req.params.id)
      .single();

    if (fetchError) {
      console.error("Błąd pobierania materiału:", fetchError);
      return res.redirect("/kursy");
    }

    const { error: deleteError } = await supabase.from("materials").delete().eq("id", req.params.id);

    if (deleteError) {
      console.error("Błąd usuwania materiału:", deleteError);
    }

    res.redirect(`/kursy/${material.course_id}/materials`);
  } catch (err) {
    console.error("Błąd serwera (usuwanie materiału):", err);
    res.redirect("/kursy");
  }
});

app.get("/kursy/:id/uczestnicy", adminOnly, requireAdmin, async (req, res) => {
  try {
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("*")
      .eq("id", req.params.id)
      .single();

    if (courseError) {
      console.error("Błąd pobierania kursu:", courseError);
      return res.redirect("/kursy");
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
    res.redirect("/kursy");
  }
});

app.post("/kursy/:id/uczestnicy", adminOnly, requireAdmin, async (req, res) => {
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

    res.redirect(`/kursy/${req.params.id}/uczestnicy`);
  } catch (err) {
    console.error("Błąd serwera (dodawanie uczestnika):", err);
    res.redirect(`/kursy/${req.params.id}/uczestnicy`);
  }
});

// ===== PANEL UCZESTNIKA (Magic Link) — tylko panel.ceea.org.pl =====

app.get("/", userOnly, (req, res) => {
  if (req.session.user) return res.redirect("/kursy");
  res.render("login", {
    title: "Logowanie — CEEA",
    error: null,
    message: null,
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