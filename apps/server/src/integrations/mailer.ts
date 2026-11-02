import nodemailer from 'nodemailer';
import type { AppConfig } from '../config.js';

export function createMailer(smtp: AppConfig['smtp']) {
  return nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
  });
}
