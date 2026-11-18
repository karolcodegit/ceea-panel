// services/adminSessions.js — sesje adminów w bazie (Supabase)
// Zastępuje app.locals.sessions (Map w pamięci procesu):
//  - sesja przetrwa restart serwera (audyt #9),
//  - w bazie trzymamy HASH tokenu (SHA-256) — wyciek tabeli nie zdradza sesji.
//
// Wymaga tabeli admin_sessions (migracja/sesje-reset-haslo.sql).

const crypto = require("crypto");
const supabase = require("../config/supabase");

const ADMIN_SESSION_TTL = 8 * 60 * 60 * 1000; // 8 h — jak dotychczas

const hashToken = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

// Tworzy sesję admina i zwraca SUROWY token (trafia tylko do ciasteczka).
async function createSession(email, ttlMs = ADMIN_SESSION_TTL) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires_at = new Date(Date.now() + ttlMs).toISOString();
  const { error } = await supabase
    .from("admin_sessions")
    .insert({ token_hash: hashToken(token), email, expires_at });
  if (error) {
    console.error("adminSessions.create:", error.message);
    return null;
  }
  return token;
}

// Zwraca { email, expires } dla ważnego tokenu albo null.
async function getSession(token) {
  if (!token) return null;
  try {
    const { data, error } = await supabase
      .from("admin_sessions")
      .select("email, expires_at")
      .eq("token_hash", hashToken(token))
      .maybeSingle();
    if (error) {
      console.error("adminSessions.get:", error.message);
      return null;
    }
    if (!data) return null;
    const expires = new Date(data.expires_at).getTime();
    if (expires <= Date.now()) {
      deleteSession(token).catch(() => {});
      return null;
    }
    return { email: data.email, expires };
  } catch (e) {
    console.error("adminSessions.get:", e.message);
    return null;
  }
}

async function deleteSession(token) {
  if (!token) return;
  const { error } = await supabase
    .from("admin_sessions")
    .delete()
    .eq("token_hash", hashToken(token));
  if (error) console.error("adminSessions.delete:", error.message);
}

// Usuwa WSZYSTKIE sesje danego admina (np. przy zmianie/resetach uprawnień).
async function deleteSessionsForEmail(email) {
  const { error } = await supabase
    .from("admin_sessions")
    .delete()
    .eq("email", email);
  if (error) console.error("adminSessions.deleteForEmail:", error.message);
}

// Porządki: usuwa wygasłe wiersze (wywoływane cyklicznie z server.js)
async function cleanup() {
  const { error } = await supabase
    .from("admin_sessions")
    .delete()
    .lt("expires_at", new Date().toISOString());
  if (error) console.error("admin_sessions cleanup:", error.message);
}

module.exports = {
  createSession,
  getSession,
  deleteSession,
  deleteSessionsForEmail,
  cleanup,
  hashToken,
};
