/** Known mail providers: the settings a customer would otherwise have to look up. Safe for client code. */
export type SmtpSecurity = "ssl" | "starttls" | "none";
export const MAILBOX_PRESETS: Record<string, { label: string; host: string; port: number; security: SmtpSecurity; imapHost: string; note?: string }> = {
  gmail: { label: "Gmail / Google Workspace", host: "smtp.gmail.com", port: 465, security: "ssl", imapHost: "imap.gmail.com", note: "استخدم «كلمة مرور التطبيق» وليس كلمة سر الحساب" },
  outlook: { label: "Outlook / Microsoft 365", host: "smtp.office365.com", port: 587, security: "starttls", imapHost: "outlook.office365.com" },
  zoho: { label: "Zoho Mail", host: "smtp.zoho.com", port: 465, security: "ssl", imapHost: "imap.zoho.com" },
  hostinger: { label: "Hostinger", host: "smtp.hostinger.com", port: 465, security: "ssl", imapHost: "imap.hostinger.com" },
  namecheap: { label: "Namecheap Private Email", host: "mail.privateemail.com", port: 465, security: "ssl", imapHost: "mail.privateemail.com" },
};

