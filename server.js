require("dotenv").config({ path: ".env" });
const express = require("express");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const supabase = require("./config/supabase");

const { loadAdminsIntoMemory } = require("./services/admins");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const userRoutes = require("./routes/user");
const { ADMIN_PREFIX, setAdminPathFlag } = require("./middleware/auth");
const { csrfToken, csrfProtect } = require("./middleware/csrf");
const SupabaseSessionStore = require("./services/sessionStore");
const adminSessions = require("./services/adminSessions");
const EmailQueue = require("./services/emailQueue");

const maintenanceGate = require("./middleware/maintenance");
const { flagsEndpoint } = require("./routes/serwis");

// ===== EXPRESS =====
const app = express();
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// ===== NAGŁÓWKI BEZPIECZEŃSTWA (helmet) =====
// CSP dopasowane do faktycznie używanych zasobów:
//  - cdn.tailwindcss.com, cdn.jsdelivr.net (xlsx), cdn.quilljs.com — skrypty,
//  - widget/upload-widget.cloudinary.com — widget uploadu,
//  - fonts.googleapis.com / fonts.gstatic.com — czcionka Inter,
//  - res.cloudinary.com — obrazki/media, api.cloudinary.com — upload z przeglądarki,
//  - kdksdqfnfqoauphpippu.supabase.co — edge function formularza feedbacku.
// 'unsafe-inline' w script/style jest WYMAGANE, dopóki używamy Tailwind Play CDN
// i inline'owych <script> w widokach (audyt #11 — Tailwind lokalnie — to usprawni).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],

        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://cdn.tailwindcss.com",
          "https://cdn.jsdelivr.net",
          "https://cdn.quilljs.com",
          "https://widget.cloudinary.com",
          "https://upload-widget.cloudinary.com",
          "https://cdn.cookie-script.com",
        ],

        // Panel używa inline'owych onclick/onsubmit.
        scriptSrcAttr: ["'unsafe-inline'"],

        

        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com",
          "https://cdn.quilljs.com",
        ],

        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com",
        ],

        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://res.cloudinary.com",
          "https://cdn.cookie-script.com",
        ],

        connectSrc: [
          "'self'",
          "https://api.cloudinary.com",
          "https://kdksdqfnfqoauphpippu.supabase.co",
          "https://cdn.cookie-script.com",
        ],

        frameSrc: [
          "'self'",
          "https://upload-widget.cloudinary.com",
        ],

        mediaSrc: [
          "'self'",
          "https://res.cloudinary.com",
        ],

        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },

    // Wyłączenie COEP, bo Cloudinary nie wysyła wymaganych nagłówków CORP.
    crossOriginEmbedderPolicy: false,
  })
);

app.use(cookieParser());
app.use(csrfToken); // token CSRF -> res.locals.csrfToken (potrzebuje req.cookies)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    // Sesje uczestników w Supabase (tabela app_sessions) — restart serwera
    // nie wylogowuje nikogo i nie zjada pamięci procesu.
    store: new SupabaseSessionStore(),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax", // ochrona CSRF na poziomie przeglądarki
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(csrfProtect); // weryfikacja tokenu — PO parserach body, PRZED routerami
app.use(express.static(path.join(__dirname, "public")));
app.use(setAdminPathFlag);

// ===== INICJALIZACJA (najpierw Mapy, potem reszta) =====
app.locals.admins = new Map();
// Sesje adminów żyją w tabeli admin_sessions (services/adminSessions.js) —
// nie w pamięci procesu.
app.locals.getIcon = require("./config/user-icons").getIcon;

const emailQueue = new EmailQueue(supabase);
app.set("emailQueue", emailQueue);

// ===== ROUTERY =====
app.use("/api/auth", authRoutes);
app.use(ADMIN_PREFIX, adminRoutes);
app.get("/api/flags", flagsEndpoint);
app.use(maintenanceGate);
app.use("/", userRoutes);




// ===== 404 =====
app.use((req, res) => {
  res.status(404).render("error", {
    title: "404 — Nie znaleziono",
    message: "Strona nie istnieje lub została przeniesiona.",
  });
});

// ===== START =====
const PORT = process.env.PORT || 3000;
let server;

async function start() {
  try {
    await loadAdminsIntoMemory(app);          // ✅ admin_users -> app.locals.admins
    console.log("Admini TOTP załadowani z bazy:", app.locals.admins.size);
  } catch (err) {
    console.error("❌ Błąd ładowania adminów:", err.message);
    process.exit(1);
  }

  server = app.listen(PORT, () => {
    console.log(`✅ Panel działa na http://localhost:${PORT}`);
  });

  // Porządki: usuwanie wygasłych sesji raz na godzinę (+ na starcie)
  const cleanupSessions = () => {
    SupabaseSessionStore.cleanup();
    adminSessions.cleanup();
  };
  cleanupSessions();
  setInterval(cleanupSessions, 60 * 60 * 1000).unref();
}

// Graceful shutdown
const shutdown = () => {
  if (typeof emailQueue.stop === "function") emailQueue.stop();
  if (server) server.close(() => process.exit(0));
  else process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

if (require.main === module) {
  start();
} else {
  module.exports = app;
}
