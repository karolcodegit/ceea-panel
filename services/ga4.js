// ═══════════════════════════════════════════════════════════════
// Wymaga pakietu: npm i @google-analytics/data
// Konto serwisowe musi mieć rolę "Przeglądający" w usłudze GA4.
// ═══════════════════════════════════════════════════════════════

let BetaAnalyticsDataClient = null;
try {
  ({ BetaAnalyticsDataClient } = require("@google-analytics/data"));
} catch {
  /* pakiet niezainstalowany — isConfigured() zwróci false */
}

let _client = null;
function getClient() {
  if (_client || !BetaAnalyticsDataClient) return _client;
  let credentials = null;
  if (process.env.GA4_CREDENTIALS_JSON_B64) {
    try {
      credentials = JSON.parse(
        Buffer.from(process.env.GA4_CREDENTIALS_JSON_B64, "base64").toString("utf8")
      );
    } catch {
      credentials = null;
    }
  } else if (process.env.GA4_CLIENT_EMAIL && process.env.GA4_PRIVATE_KEY) {
    credentials = {
      client_email: process.env.GA4_CLIENT_EMAIL,
      private_key: process.env.GA4_PRIVATE_KEY.replace(/\\n/g, "\n"),
    };
  }
  if (!credentials) return null;
  _client = new BetaAnalyticsDataClient({ credentials });
  return _client;
}

function isConfigured() {
  return Boolean(
    BetaAnalyticsDataClient && process.env.GA4_PROPERTY_ID && getClient()
  );
}

// Cache w pamięci procesu — GA4 Data API ma limity, a dane nie muszą być co sekundę
let _cache = { at: 0, data: null };
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minut

const metric = (row, i) => Number(row?.metricValues?.[i]?.value || 0);
const dim = (row, i) => row?.dimensionValues?.[i]?.value || "";

async function _fetchStats() {
  const client = getClient();
  const property = `properties/${process.env.GA4_PROPERTY_ID}`;

  const totals = (startDate) => ({
    property,
    dateRanges: [{ startDate, endDate: "today" }],
    metrics: [
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "newUsers" },
      { name: "userEngagementDuration" },
    ],
  });

  const [rToday, rWeek, rMonth, rSources, rDevices] = await Promise.all([
    client.runReport(totals("today")),
    client.runReport(totals("6daysAgo")),
    client.runReport(totals("29daysAgo")),
    client.runReport({
      property,
      dateRanges: [{ startDate: "29daysAgo", endDate: "today" }],
      dimensions: [{ name: "sessionDefaultChannelGroup" }],
      metrics: [{ name: "sessions" }],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 6,
    }),
    client.runReport({
      property,
      dateRanges: [{ startDate: "29daysAgo", endDate: "today" }],
      dimensions: [{ name: "deviceCategory" }],
      metrics: [{ name: "totalUsers" }],
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
      limit: 4,
    }),
  ]);

  // raport bez wymiarów = jeden wiersz podsumowania
  const first = (r) => r[0]?.rows?.[0];
  const month = first(rMonth);
  const users30 = metric(month, 0);
  const engagedSec = metric(month, 3);

  return {
    configured: true,
    visitors: {
      today: metric(first(rToday), 0),
      week: metric(first(rWeek), 0),
      month: users30,
    },
    sessions30: metric(month, 1),
    newUsers30: metric(month, 2),
    avgEngagementSec: users30 ? Math.round(engagedSec / users30) : 0,
    sources: (rSources[0]?.rows || []).map((r) => ({
      name: dim(r, 0),
      count: metric(r, 0),
    })),
    devices: (rDevices[0]?.rows || []).map((r) => ({
      name: dim(r, 0),
      count: metric(r, 0),
    })),
    fetchedAt: new Date().toISOString(),
  };
}

async function getDashboardStats() {
  if (!isConfigured()) return { configured: false };
  if (_cache.data && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.data;
  const data = await _fetchStats();
  _cache = { at: Date.now(), data };
  return data;
}

module.exports = { getDashboardStats, isConfigured };