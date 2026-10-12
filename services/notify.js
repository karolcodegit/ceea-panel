// services/notify.js — powiadomienia zespołu w panelu (bez maili organizatora)
const supabase = require("../config/supabase");

async function notify({ type, title, body = "", link = null }) {
  const { error } = await supabase.from("notifications").insert({ type, title, body, link });
  if (error) console.error("notify:", error.message);
}

module.exports = { notify };