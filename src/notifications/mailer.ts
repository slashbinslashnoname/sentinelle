/**
 * Email delivery. A thin {@link Mailer} interface so the notifier can be tested
 * with a fake, plus an SMTP implementation backed by nodemailer.
 */

import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  from: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** Verify the connection/credentials (for the admin "test" button). */
  verify(): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(cfg: SmtpConfig) {
    this.transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail(message);
  }

  async verify(): Promise<void> {
    await this.transport.verify();
  }
}
