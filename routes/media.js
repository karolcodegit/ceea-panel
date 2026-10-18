const express = require("express");
const crypto = require("crypto");
const router = express.Router();
const { requireAdmin, adminOnly } = require("../middleware/auth");

// ═══════════════════════════════════════════════════════════════
// ===== MEDIA — galeria Cloudinary w panelu =====
// Upload: client-side widget (unsigned preset). Przeglądanie/usuwanie:
// Admin API (wymaga CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET w env).
// ═══════════════════════════════════════════════════════════════

const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const PRESET = process.env.CLOUDINARY_UPLOAD_PRESET;
const API_KEY = process.env.CLOUDINARY_API_KEY;
const API_SECRET = process.env.CLOUDINARY_API_SECRET;

const FOLDERS = [
  { id: "books", name: "Książki" },
  { id: "courses", name: "Kursy" },
  { id: "sponsors", name: "Sponsorzy" },
  { id: "ceea-materialy", name: "Materiały" },
  { id: "", name: "Wszystkie" },
];

const ALLOWED_PREFIXES = ["books", "courses", "sponsors", "ceea-materialy", "ceea"];

// ── Strona galerii ──
router.get("/media", adminOnly, requireAdmin, (req, res) => {
  res.render("admin-media", {
    isAdmin: true,
    active: "media",
    cloudName: CLOUD || "",
    uploadPreset: PRESET || "",
    hasAdminApi: !!(API_KEY && API_SECRET),
    folders: FOLDERS,
    query: req.query,
  });
});

// ── API: lista zdjęć (proxy do Admin API) ──
router.get("/api/media", adminOnly, requireAdmin, async (req, res) => {
  try {
    if (!CLOUD || !API_KEY || !API_SECRET) {
      return res.status(500).json({ error: "Brak CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET w env panelu." });
    }
    const prefix = (req.query.folder || "").replace(/\/+$/, "");
    const max = Math.min(Number(req.query.max) || 50, 100);
    let url = `https://api.cloudinary.com/v1_1/${CLOUD}/resources/image/upload?prefix=${encodeURIComponent(prefix)}&max_results=${max}&type=upload`;
    if (req.query.next_cursor) url += `&next_cursor=${encodeURIComponent(req.query.next_cursor)}`;

    const r = await fetch(url, {
      headers: {
        Authorization: "Basic " + Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64"),
      },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: j.error?.message || "Cloudinary Admin API error" });

    res.json({
      resources: (j.resources || []).map(x => ({
        public_id: x.public_id,
        url: x.secure_url,
        thumb: x.secure_url.replace("/upload/", "/upload/w_400,h_300,c_fit/"),
        bytes: x.bytes,
        width: x.width,
        height: x.height,
        created_at: x.created_at,
        folder: x.folder || "",
      })),
      next_cursor: j.next_cursor || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: usuń zdjęcie (signed destroy) ──
router.post("/api/media/usun", adminOnly, requireAdmin, async (req, res) => {
  try {
    if (!CLOUD || !API_KEY || !API_SECRET) {
      return res.status(500).json({ error: "Brak kluczy Admin API w env." });
    }
    const publicId = String(req.body.public_id || "").trim();
    if (!publicId || !ALLOWED_PREFIXES.some(p => publicId === p || publicId.startsWith(p + "/"))) {
      return res.status(400).json({ error: "Nieprawidłowy public_id." });
    }
    const timestamp = Math.round(Date.now() / 1000);
    const toSign = `public_id=${publicId}&timestamp=${timestamp}${API_SECRET}`;
    const signature = crypto.createHash("sha1").update(toSign).digest("hex");

    const body = new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: API_KEY,
      signature,
    });

    const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/destroy`, {
      method: "POST",
      body,
    });
    const j = await r.json().catch(() => ({}));
    if (j.result !== "ok") return res.status(500).json({ error: j.error?.message || "Nie udało się usunąć" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: podpis dla Media Library widget (wybór z galerii) ──
router.get("/api/media/sign", adminOnly, requireAdmin, async (req, res) => {
  try {
    const username = process.env.CLOUDINARY_ML_USER; // email konta Cloudinary
    if (!CLOUD || !API_KEY || !API_SECRET || !username) {
      return res.status(500).json({ error: "Brak CLOUDINARY_ML_USER (email konta Cloudinary) lub kluczy w env." });
    }
    const timestamp = Math.round(Date.now() / 1000);
    const toSign = `cloud_name=${CLOUD}&timestamp=${timestamp}&username=${username}${API_SECRET}`;
    const signature = crypto.createHash("sha1").update(toSign).digest("hex");
    res.json({ cloudName: CLOUD, apiKey: API_KEY, username, timestamp, signature });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API: test integracji (realny ping do Admin API) ──
router.get("/api/media/test", adminOnly, requireAdmin, async (req, res) => {
  const checks = {
    cloudName: !!CLOUD,
    uploadPreset: !!PRESET,
    apiKey: !!API_KEY,
    apiSecret: !!API_SECRET,
    adminApi: false,
  };
  let message = "";
  try {
    if (CLOUD && API_KEY && API_SECRET) {
      const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/usage`, {
        headers: {
          Authorization: "Basic " + Buffer.from(`${API_KEY}:${API_SECRET}`).toString("base64"),
        },
      });
      checks.adminApi = r.ok;
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        message = j.error?.message || `HTTP ${r.status}`;
      }
    }
  } catch (err) {
    message = err.message;
  }
  const ok = checks.cloudName && checks.uploadPreset && checks.adminApi;
  res.json({ ok, checks, message });
});

module.exports = router;
