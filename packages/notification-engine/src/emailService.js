/**
 * v30.0 — Email Service
 * Wraps nodemailer. Sends via Gmail SMTP (or any SMTP).
 * If SMTP is not configured, emails are logged but not sent (dev mode).
 * Includes retry with exponential backoff (3 attempts).
 */
const nodemailer = require('nodemailer');

class EmailService {
  constructor({ logger = null } = {}) {
    this.logger = logger;
    this.transporter = null;
    this.fromAddress = null;
    this.configured = false;
    this._configure();
  }

  _configure() {
    const host = process.env.NOVA_SMTP_HOST;
    const port = Number(process.env.NOVA_SMTP_PORT || 587);
    const user = process.env.NOVA_SMTP_USER;
    const pass = process.env.NOVA_SMTP_PASS;
    const from = process.env.NOVA_SMTP_FROM;

    if (!host || !user || !pass) {
      // Dev mode — log instead of sending
      this.configured = false;
      return;
    }

    try {
      this.transporter = nodemailer.createTransport({
        host, port,
        secure: port === 465,
        auth: { user, pass },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
      });
      this.fromAddress = from || `Nova Assistant <${user}>`;
      this.configured = true;
      this.logger?.info?.('email_service.configured', { host, user, from: this.fromAddress });
    } catch (error) {
      this.configured = false;
      this.logger?.error?.('email_service.config_failed', { error: error.message });
    }
  }

  async send({ to, subject, html, text }) {
    if (!this.configured || !this.transporter) {
      // Dev mode — log the email instead of sending
      this.logger?.info?.('email_service.dev_mode_log', { to, subject, textPreview: (text || '').slice(0, 200) });
      return { ok: true, dev: true, message: 'Email logged (SMTP not configured). Set NOVA_SMTP_HOST/USER/PASS to send real emails.' };
    }

    // Validate recipients
    const recipients = Array.isArray(to) ? to.filter(Boolean) : [to].filter(Boolean);
    if (recipients.length === 0) {
      return { ok: false, error: 'No recipients specified' };
    }

    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const info = await this.transporter.sendMail({
          from: this.fromAddress,
          to: recipients.join(', '),
          subject,
          html,
          text: text || subject
        });
        this.logger?.info?.('email_service.sent', { to: recipients, subject, messageId: info.messageId, attempt: attempt + 1 });
        return { ok: true, messageId: info.messageId, recipients };
      } catch (error) {
        lastError = error;
        this.logger?.warn?.('email_service.send_failed', { attempt: attempt + 1, error: error.message });
        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
    return { ok: false, error: lastError?.message || 'Failed after 3 retries' };
  }

  async verifyConnection() {
    if (!this.configured) return { ok: false, configured: false, message: 'SMTP not configured' };
    try {
      await this.transporter.verify();
      return { ok: true, configured: true, message: 'SMTP connection verified' };
    } catch (error) {
      return { ok: false, configured: true, error: error.message };
    }
  }

  getStatus() {
    return {
      configured: this.configured,
      host: process.env.NOVA_SMTP_HOST || null,
      port: Number(process.env.NOVA_SMTP_PORT || 587),
      user: process.env.NOVA_SMTP_USER ? '***configured***' : null,
      from: this.fromAddress
    };
  }
}

module.exports = { EmailService };
