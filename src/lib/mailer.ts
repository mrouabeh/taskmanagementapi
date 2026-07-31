import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'

let transporter: Transporter | null = null

/**
 * Null when SMTP_URL is unset. Callers log the message instead of sending, so
 * development and tests need no credentials and never mail a real address.
 */
export function getTransporter(): Transporter | null {
  if (!env.SMTP_URL) return null
  if (!transporter) transporter = nodemailer.createTransport(env.SMTP_URL)
  return transporter
}

export async function sendMail(msg: { to: string; subject: string; text: string; html: string }) {
  const t = getTransporter()
  if (!t) {
    console.log(`[mail:dry-run] to=${msg.to} subject=${msg.subject}\n${msg.text}`)
    return
  }
  await t.sendMail({ from: env.MAIL_FROM, ...msg })
}

export async function closeMailer() {
  transporter?.close()
  transporter = null
}
