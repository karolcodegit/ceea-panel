// middleware/csrf.js — ochrona CSRF (Cross-Site Request Forgery)
//
// Wzorzec: "signed double-submit cookie".
//  1. Serwer generuje losowy token i zapisuje go w ciasteczku `csrfToken`
//     w postaci "token.podpisHMAC" (podpis chroni przed podrzuceniem
//     własnego ciasteczka przez atakującego, np. z subdomeny).
//  2. Token trafia do widoków przez res.locals.csrfToken:
//     - formularze HTML wysyłają go w ukrytym polu `_csrf`,
//     - fetch()/AJAX wysyła go w nagłówku `X-CSRF-Token` (odczyt z <meta>).
//  3. Przy każdym żądaniu zmieniającym stan (POST/PUT/PATCH/DELETE)
//     middleware porównuje przesłany token z tokenem z ciasteczka.
//     Atakujący z obcej domeny nie zna wartości tokenu (Same-Origin Policy),
//     więc nie jest w stanie złożyć poprawnego żądania.
//
// Implementacja jest bezstanowa (nie zapisuje nic w sesji ani bazie),
// więc przetrwa restart serwera i nie obciąża pamięci.

const crypto = require("crypto");

const COOKIE_NAME = "csrfToken";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 dni, jak sesja

function secret() {
  return process.env.SESSION_SECRET || "ceea-csrf-dev-secret";
}

function sign(token) {
  return crypto.createHmac("sha256", secret()).update(token).digest("hex");
}

// Porównanie w stałym czasie — bez wycieku długości ani treści tokenu.
function safeEq(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Odczytuje token z ciasteczka (albo tworzy nowy) i wystawia go widokom.
// Montować PO cookieParser, PRZED routerami.
function csrfToken(req, res, next) {
  let token = null;
  const raw = req.cookies ? req.cookies[COOKIE_NAME] : null;

  if (typeof raw === "string") {
    const dot = raw.indexOf(".");
    if (dot > 0) {
      const t = raw.slice(0, dot);
      const sig = raw.slice(dot + 1);
      if (safeEq(sig, sign(t))) token = t;
    }
  }

  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    res.cookie(COOKIE_NAME, `${token}.${sign(token)}`, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE,
    });
  }

  req.csrfTokenValue = token;
  res.locals.csrfToken = token; // dostępne w każdym widoku EJS
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Endpointy zwolnione z weryfikacji CSRF:
//  - /api/track — publiczny beacon analityczny wysyłany przez sendBeacon(),
//    który nie może ustawić nagłówków; endpoint nie zmienia danych użytkownika
//    i nie jest powiązany z sesją admina.
const EXEMPT_PATHS = new Set(["/api/track"]);

// Weryfikuje token przy żądaniach zmieniających stan.
// Montować PO parserach body (express.urlencoded / express.json).
function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT_PATHS.has(req.path)) return next();

  const sent =
    (req.body && req.body._csrf) ||
    req.get("x-csrf-token") ||
    req.query._csrf;

  if (sent && req.csrfTokenValue && safeEq(sent, req.csrfTokenValue)) {
    return next();
  }

  return res.status(403).json({
    error: "Nieprawidłowy lub wygasły token bezpieczeństwa (CSRF). Odśwież stronę i spróbuj ponownie.",
  });
}

module.exports = { csrfToken, csrfProtect };
