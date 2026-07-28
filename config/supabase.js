const { createClient } = require("@supabase/supabase-js");
const WebSocket = require("ws");

module.exports = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { realtime: { transport: WebSocket }, auth: { autoRefreshToken: false, persistSession: false } }
);