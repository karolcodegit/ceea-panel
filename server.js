require("dotenv").config({ path: ".env" });
const express = require("express");
const path = require("path");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const { initializeAdmins } = require("./config/admins");
const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const userRoutes = require("./routes/user");
const { ADMIN_PREFIX, setAdminPathFlag } = require("./middleware/auth");

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
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);
app.use(express.static(path.join(__dirname, "public")));
app.use(setAdminPathFlag);

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

// ===== ROUTERY =====
app.use("/api/auth", authRoutes);
app.use(ADMIN_PREFIX, adminRoutes);
app.use("/", userRoutes);

// ===== 404 (musi być PO routerach) =====
app.use((req, res) => {
  res.status(404).render("error", {
    title: "404 — Nie znaleziono",
    message: "Strona nie istnieje lub została przeniesiona.",
  });
});

// ===== START =====
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    const admins = await initializeAdmins();
    app.locals.admins = admins;
    console.log("Admini TOTP zainicjalizowani:", admins.size);
  } catch (err) {
    console.error("❌ Błąd inicjalizacji adminów:", err.message);
    process.exit(1); // Northflank sam zrestartuje kontener i spróbuje ponownie
  }

  app.listen(PORT, () => {
    console.log(`✅ Panel działa na http://localhost:${PORT}`);
    console.log(`📅 Data uruchomienia: ${new Date().toISOString()}`);
  });
}

if (require.main === module) {
  start();
} else {
  module.exports = app;
}