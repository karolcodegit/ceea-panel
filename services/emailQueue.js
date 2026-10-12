// services/emailQueue.js — kolejka wysyłki maili (dławienie: 1 mail / 45 s, limit dzienny)
// Transport: services/mailer.js (Zoho ZeptoMail EU -> MailerSend fallback) – NIE SMTP.
// Schemat bez zmian: email_queue (recipient_email, subject, body_html, body_text, status,
// attempts, scheduled_at, error_message, sent_at), email_logs, email_daily_stats.
//
// POPRAWKA: zapytania na email_daily_stats używają .limit(1) zamiast .single() —
// pusty wynik daje 200 + [], a nie 406 (PostgREST zwraca 406 dla pojedynczego
// selecta bez wierszy), więc logi Supabase przestają pokazywać false-warnings.
const { sendMail } = require("./mailer");

const DAILY_LIMIT = Number(process.env.EMAIL_DAILY_LIMIT || 50);
const DELAY_MS = 45000;

class EmailQueue {
  constructor(supabase) {
    this.supabase = supabase;
    this.processing = false;
    this.timer = setInterval(() => this.process(), DELAY_MS);
  }

  async enqueue({ recipientEmail, recipientName, subject, html, text, courseId, templateKey }) {
    const { data, error } = await this.supabase
      .from("email_queue")
      .insert({
        recipient_email: recipientEmail,
        recipient_name: recipientName,
        subject,
        body_html: html,
        body_text: text,
        course_id: courseId,
        template_key: templateKey,
        status: "pending",
        scheduled_at: new Date().toISOString(),
      })
      .select("id");

    if (error) throw error;
    return data[0].id;
  }

  async getDailyCount() {
    const today = new Date().toISOString().split("T")[0];
    const { data, error } = await this.supabase
      .from("email_daily_stats")
      .select("count")
      .eq("date", today)
      .limit(1);

    if (error) throw error;
    return data?.[0]?.count ?? 0;
  }

  async process() {
    if (this.processing) return;
    this.processing = true;

    let mail = null;

    try {
      const daily = await this.getDailyCount();
      if (daily >= DAILY_LIMIT) {
        console.log(`[EmailQueue] Limit dzienny osiągnięty (${DAILY_LIMIT})`);
        return;
      }

      const { data: rows, error: fetchErr } = await this.supabase
        .from("email_queue")
        .select("*")
        .eq("status", "pending")
        .lte("scheduled_at", new Date().toISOString())
        .order("created_at", { ascending: true })
        .limit(1);

      if (fetchErr) throw fetchErr;
      if (!rows || rows.length === 0) return;

      mail = rows[0];

      // ── TRANSPORT przez mailer.js (ZeptoMail EU -> MailerSend fallback) ──
      await sendMail({
        to: mail.recipient_email,
        toName: mail.recipient_name,
        subject: mail.subject,
        text: mail.body_text,
        html: mail.body_html,
      });

      const now = new Date().toISOString();
      await this.supabase
        .from("email_queue")
        .update({ status: "sent", sent_at: now })
        .eq("id", mail.id);

      const today = now.split("T")[0];

      // Inkrementacja licznika dziennego (bez RPC, bezpieczne przy 1 mailu co 45s)
      const { data: existingRows } = await this.supabase
        .from("email_daily_stats")
        .select("count")
        .eq("date", today)
        .limit(1);

      const existing = existingRows?.[0];

      if (existing) {
        await this.supabase
          .from("email_daily_stats")
          .update({ count: existing.count + 1 })
          .eq("date", today);
      } else {
        await this.supabase
          .from("email_daily_stats")
          .insert({ date: today, count: 1 });
      }

      await this.supabase.from("email_logs").insert({
        queue_id: mail.id,
        recipient_email: mail.recipient_email,
        status: "sent",
        message: "OK",
      });

      console.log(`[EmailQueue] Wysłano do ${mail.recipient_email}`);

    } catch (err) {
      console.error("[EmailQueue] Błąd:", err.message);
      if (mail) {
        const attempts = (mail.attempts || 0) + 1;
        const status = attempts >= 3 ? "failed" : "pending";
        const nextAt = attempts < 3
          ? new Date(Date.now() + Math.pow(2, attempts) * 60000).toISOString()
          : null;

        await this.supabase
          .from("email_queue")
          .update({
            attempts,
            status,
            error_message: err.message,
            scheduled_at: nextAt || mail.scheduled_at,
          })
          .eq("id", mail.id);

        await this.supabase.from("email_logs").insert({
          queue_id: mail.id,
          recipient_email: mail.recipient_email,
          status,
          message: err.message,
        });
      }
    } finally {
      this.processing = false;
    }
  }

  async getStats() {
    const { count: pendingCount } = await this.supabase
      .from("email_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");

    const { count: failedCount } = await this.supabase
      .from("email_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed");

    const today = new Date().toISOString().split("T")[0];
    const { data: dailyRows } = await this.supabase
      .from("email_daily_stats")
      .select("count")
      .eq("date", today)
      .limit(1);

    return {
      pending: pendingCount || 0,
      failed: failedCount || 0,
      sentToday: dailyRows?.[0]?.count || 0,
      limit: DAILY_LIMIT,
    };
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = EmailQueue;
