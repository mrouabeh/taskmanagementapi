import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '../config/env'

let transporter: Transporter | null = null

export async function sendMail(msg: { to: string; subject: string; text: string; html: string }) {
  if (!env.SMTP_URL) {
    console.log(`[mail:dry-run] to=${msg.to} subject=${msg.subject}\n${msg.text}`)
    return
  }
  if (!transporter) transporter = nodemailer.createTransport(env.SMTP_URL)
  await transporter.sendMail({ from: env.MAIL_FROM, ...msg })
}
