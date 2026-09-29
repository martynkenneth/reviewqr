// Sends email through SMTP when SMTP_URL is set. Without it (local
// development) emails are printed to the console instead.
const nodemailer = require('nodemailer');
const config = require('../config');

const transport = config.smtpUrl ? nodemailer.createTransport(config.smtpUrl) : null;

async function sendMail({ to, subject, text }) {
  if (!transport) {
    console.log(`\n--- Email (SMTP_URL not set, not sent) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
    return;
  }
  await transport.sendMail({ from: config.mailFrom, to, subject, text });
}

module.exports = { sendMail };
