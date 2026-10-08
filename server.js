require("dotenv").config({ path: ".env" });
const express = require("express");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

const { loadAdminsIntoMemory } = require("./services/admins");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const userRoutes = require("./routes/user");
const { ADMIN_PREFIX, setAdminPathFlag } = require("./middleware/auth");
const EmailQueue = require("./services/emailQueue");

// ===== SUPABASE =====
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: WebSocket } }
);

// ===== EXPRESS =====
const app = express();
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === "production", httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, "public")));
app.use(setAdminPathFlag);

// ===== INICJALIZACJA (najpierw Mapy, potem reszta) =====
app.locals.admins = new Map();
app.locals.sessions = new Map();

const emailQueue = new EmailQueue(supabase);
app.set("emailQueue", emailQueue);

// ===== ROUTERY =====
app.use("/api/auth", authRoutes);
app.use(ADMIN_PREFIX, adminRoutes);
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