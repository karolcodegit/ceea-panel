// services/sessionStore.js — magazyn sesji express-session w Supabase (Postgres)
// Zastępuje domyślny MemoryStore: sesje uczestników przetrwają restart
// serwera i nie zajmują pamięci procesu (audyt #9).
//
// Wymaga tabeli app_sessions (migracja/sesje-reset-haslo.sql).

const session = require("express-session");
const supabase = require("../config/supabase");

const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // jak w konfiguracji cookie

class SupabaseSessionStore extends session.Store {
  async get(sid, cb) {
    try {
      const { data, error } = await supabase
        .from("app_sessions")
        .select("sess, expires_at")
        .eq("sid", sid)
        .maybeSingle();
      if (error) return cb(error);
      if (!data) return cb(null, null);
      if (new Date(data.expires_at).getTime() <= Date.now()) {
        this.destroy(sid, () => {});
        return cb(null, null);
      }
      cb(null, data.sess);
    } catch (e) {
      cb(e);
    }
  }

  async set(sid, sess, cb) {
    try {
      const maxAge = sess?.cookie?.maxAge ?? DEFAULT_MAX_AGE;
      const expires_at = new Date(Date.now() + maxAge).toISOString();
      const { error } = await supabase
        .from("app_sessions")
        .upsert({ sid, sess, expires_at });
      if (cb) cb(error || null);
    } catch (e) {
      if (cb) cb(e);
    }
  }

  async destroy(sid, cb) {
    try {
      const { error } = await supabase
        .from("app_sessions")
        .delete()
        .eq("sid", sid);
      if (cb) cb(error || null);
    } catch (e) {
      if (cb) cb(e);
    }
  }

  // express-session woła touch przy każdej aktywności — odświeżamy wygaśnięcie
  async touch(sid, sess, cb) {
    try {
      const maxAge = sess?.cookie?.maxAge ?? DEFAULT_MAX_AGE;
      const expires_at = new Date(Date.now() + maxAge).toISOString();
      const { error } = await supabase
        .from("app_sessions")
        .update({ expires_at })
        .eq("sid", sid);
      if (cb) cb(error || null);
    } catch (e) {
      if (cb) cb(e);
    }
  }

  // Porządki: usuwa wygasłe wiersze (wywoływane cyklicznie z server.js)
  static async cleanup() {
    const { error } = await supabase
      .from("app_sessions")
      .delete()
      .lt("expires_at", new Date().toISOString());
    if (error) console.error("app_sessions cleanup:", error.message);
  }
}

module.exports = SupabaseSessionStore;
