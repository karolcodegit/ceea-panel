// services/flags.js — flagi aplikacji (tryb serwisowy) z cache w pamięci
const supabase = require("../config/supabase");

const cache = new Map();   // key -> { data, ts }
const TTL = 15 * 1000;     // 15 s — flagi odświeżają się prawie natychmiast po zmianie

async function getFlags() {
  if (cache.has("all") && Date.now() - cache.get("all").ts < TTL) {
    return cache.get("all").data;
  }
  const { data } = await supabase.from("app_flags").select("*");
  const flags = {};
  (data || []).forEach(f => { flags[f.key] = { enabled: !!f.enabled, message: f.message || "" }; });
  cache.set("all", { data: flags, ts: Date.now() });
  return flags;
}

async function setFlag(key, enabled, message, updatedBy) {
  const { error } = await supabase.from("app_flags").update({
    enabled: !!enabled,
    message: message || null,
    updated_at: new Date().toISOString(),
    updated_by: updatedBy,
  }).eq("key", key);
  if (error) throw error;
  cache.clear();
}

module.exports = { getFlags, setFlag };