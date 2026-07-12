const express = require("express");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");
const speakeasy = require("speakeasy");
const { initializeAdmins } = require("./config/admins");
const authRoutes = require("./routes/auth");

// === Ładujemy dotenv TYLKO lokalnie ===
if (process.env.NODE_ENV !== "production") {
  require("dotenv").config({ path: '.env' });
}

// === DEBUG ===
console.log("=== ENV DEBUG ===");
console.log("NODE_ENV:", process.env.NODE_ENV || "undefined");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "✅ PRESENT" : "❌ MISSING");
console.log("SUPABASE_SERVICE_KEY:", process.env.SUPABASE_SERVICE_KEY ? "✅ PRESENT" : "❌ MISSING");
console.log("SESSION_SECRET:", process.env.SESSION_SECRET ? "✅ PRESENT" : "❌ MISSING");
console.log("PORT:", process.env.PORT || "3000");
console.log("================");

// === WALIDACJA ===
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.SESSION_SECRET) {
  console.error("❌ BRAK WYMAGANYCH ZMIENNYCH ŚRODOWISKOWYCH!");
  process.exit(1);
}

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
      return res.render("admin-kursy", { isAdmin: true, courses: [], error: error.message });
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

app.get(ADMIN_PREFIX + "/kursy/:id/materials", adminOnly, requireAdmin, async (req, res) => {
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
});

app.post(ADMIN_PREFIX + "/kursy/:id/materials", adminOnly, requireAdmin, async (req, res) => {
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
});

app.post(ADMIN_PREFIX + "/materials/:id/delete", adminOnly, requireAdmin, async (req, res) => {
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

    const { error: deleteError } = await supabase.from("materials").delete().eq("id", req.params.id);

    if (deleteError) {
      console.error("Błąd usuwania materiału:", deleteError);
    }

    res.redirect(ADMIN_PREFIX + `/kursy/${material.course_id}/materials`);
  } catch (err) {
    console.error("Błąd serwera (usuwanie materiału):", err);
    res.redirect(ADMIN_PREFIX + "/kursy");
  }
});

app.get(ADMIN_PREFIX + "/kursy/:id/uczestnicy", adminOnly, requireAdmin, async (req, res) => {
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
});

app.post(ADMIN_PREFIX + "/kursy/:id/uczestnicy", adminOnly, requireAdmin, async (req, res) => {
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
});

// ===== PANEL UCZESTNIKA — / (root) =====

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


// ===== STRONA POMOCY =====
app.get("/pomoc", (req, res) => {
  const categories = [
    {
      id: 'logowanie',
      title: 'Logowanie',
      description: 'Magic link, problemy z emailem, wygasłe linki',
      icon: `<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>`,
      questions: [
        {
          question: 'Jak się zalogować po raz pierwszy?',
          answer: `<p>Logowanie odbywa się przez <strong>magiczny link</strong> — bez hasła:</p>
            <ol class="list-decimal list-inside space-y-2 ml-1 mt-2">
              <li>Wpisz adres email podany przy rejestracji na kurs</li>
              <li>Kliknij <strong>"Wyślij link logowania"</strong></li>
              <li>Sprawdź skrzynkę (i folder SPAM) — wyślemy link</li>
              <li>Kliknij link w emailu — zalogujesz się automatycznie</li>
            </ol>
            <div class="mt-3 p-3 bg-amber-50/80 rounded-xl text-amber-800 text-xs border border-amber-100">
              ⚠️ Link ważny jest 1 godzinę. Jeśli wygasnie, wyślij nowy.
            </div>`
        },
        {
          question: 'Nie dostaję emaila z linkiem',
          answer: `<p>Sprawdź w tej kolejności:</p>
            <ul class="list-disc list-inside space-y-1.5 ml-1 mt-2">
              <li>Folder <strong>SPAM</strong> lub <strong>Oferty</strong> (Gmail)</li>
              <li>Czy wpisałeś poprawny adres (bez literówek)</li>
              <li>Czy firma nie blokuje emaili (zapora/firewall)</li>
              <li>Poczekaj 2-3 minuty — email może mieć opóźnienie</li>
            </ul>
            <p class="mt-3">Nadal nic? <a href="#kontakt" class="text-red-600 hover:text-red-700 font-medium underline">Napisz do nas</a>.</p>`
        },
        {
          question: 'Link wygasł — co robić?',
          answer: `<p>Magiczny link wygasa po <strong>1 godzinie</strong> ze względów bezpieczeństwa.</p>
            <p class="mt-2">Wystarczy wrócić na stronę logowania i <strong>wyślij nowy link</strong> — jest darmowy i nieograniczony.</p>`
        }
      ]
    },
    {
      id: 'kursy',
      title: 'Kursy i materiały',
      description: 'Dostęp do kursów, pobieranie plików, certyfikaty',
      icon: `<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/></svg>`,
      questions: [
        {
          question: 'Gdzie znajdują się moje kursy?',
          answer: `<p>Po zalogowaniu zobaczysz listę wszystkich kursów, na które jesteś zapisany. Kliknij kurs, aby przejść do materiałów.</p>
            <p class="mt-2">Jeśli nie widzisz kursu — upewnij się, że organizator potwierdził Twoją rejestrację.</p>`
        },
        {
          question: 'Czy mogę pobrać materiały na dysk?',
          answer: `<p>Tak! Każdy materiał ma przycisk <strong>"Pobierz"</strong> lub <strong>"Otwórz"</strong>.</p>
            <p class="mt-2">Możesz też kliknąć prawym przyciskiem myszy i wybrać <strong>"Zapisz jako"</strong>.</p>`
        },
        {
          question: 'Materiały się nie otwierają',
          answer: `<p>Sprawdź:</p>
            <ul class="list-disc list-inside space-y-1.5 ml-1 mt-2">
              <li>Stabilne połączenie internetowe</li>
              <li>Czy przeglądarka nie blokuje wyskakujących okienek</li>
              <li>Czy masz program do PDF (Adobe Reader, przeglądarka)</li>
              <li>Wyłącz blokera reklam (AdBlock) — może blokować wideo</li>
            </ul>`
        }
      ]
    },
    {
      id: 'techniczne',
      title: 'Techniczne',
      description: 'Błędy, niedziałające pliki, problemy z przeglądarką',
      icon: `<svg class="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>`,
      questions: [
        {
          question: 'Jaka przeglądarka jest najlepsza?',
          answer: `<p>Zalecamy najnowsze wersje:</p>
            <ul class="list-disc list-inside space-y-1 ml-1 mt-2">
              <li><strong>Google Chrome</strong> (najlepsza kompatybilność)</li>
              <li><strong>Mozilla Firefox</strong></li>
              <li><strong>Safari</strong> (macOS/iOS)</li>
              <li><strong>Microsoft Edge</strong></li>
            </ul>
            <p class="mt-2">Unikaj Internet Explorera — nie jest wspierany.</p>`
        },
        {
          question: 'Strona się nie wczytuje / biały ekran',
          answer: `<p>Wykonaj w tej kolejności:</p>
            <ol class="list-decimal list-inside space-y-1.5 ml-1 mt-2">
              <li>Odśwież stronę (Ctrl+R / Cmd+R)</li>
              <li>Wyczyść cache przeglądarki (Ctrl+Shift+R)</li>
              <li>Spróbuj w trybie incognito</li>
              <li>Wyłącz rozszerzenia (AdBlock, VPN)</li>
            </ol>`
        }
      ]
    }
  ];

  res.render("help/index", {
    title: "Centrum Pomocy — CEEA Panel",
    categories
  });
});

// ===== POLITYKA PRYWATNOŚCI =====
app.get("/polityka-prywatnosci", (req, res) => {
  res.render("privacy/index", {
    title: "Polityka Prywatności — CEEA Panel"
  });
});

// ===== REGULAMIN =====
app.get("/regulamin", (req, res) => {
  res.render("terms/index", {
    title: "Regulamin — CEEA Panel"
  });
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