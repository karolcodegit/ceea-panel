const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.zoho.eu",
  port: 465,
  secure: true,
  auth: {
    user: process.env.ZOHO_USER,
    pass: process.env.ZOHO_PASS,
  },
  pool: false,
});

const DAILY_LIMIT = 50;
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
      .single();

    if (error && error.code !== "PGRST116") throw error;
    return data ? data.count : 0;
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

      await transporter.sendMail({
        from: `"CEEA Poznań" <${process.env.ZOHO_USER}>`,
        to: mail.recipient_email,
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
      const { data: existing } = await this.supabase
        .from("email_daily_stats")
        .select("count")
        .eq("date", today)
        .single();

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
    const { data: dailyRow } = await this.supabase
      .from("email_daily_stats")
      .select("count")
      .eq("date", today)
      .single();

    return {
      pending: pendingCount || 0,
      failed: failedCount || 0,
      sentToday: dailyRow?.count || 0,
      limit: DAILY_LIMIT,
    };
  }

  stop() {
    clearInterval(this.timer);
  }
}

module.exports = EmailQueue;