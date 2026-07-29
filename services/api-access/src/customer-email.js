import { SendEmailCommand } from "@aws-sdk/client-sesv2";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function createCustomerEmailGateway(sesClient, { sender, replyTo }) {
  if (!sesClient || typeof sesClient.send !== "function") throw new Error("SES client is required.");
  if (typeof sender !== "string" || !sender.includes("@")) throw new Error("Customer authentication sender is required.");

  return {
    async sendMagicLink({ email, url, expiresMinutes }) {
      const safeUrl = escapeHtml(url);
      const text = `Sign in to your SolveLang API account:\n\n${url}\n\nThis link expires in ${expiresMinutes} minutes and can be used once. If you did not request it, ignore this email.`;
      const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6"><div style="max-width:560px;margin:0 auto;padding:32px"><h1 style="font-size:24px">Sign in to SolveLang API</h1><p>Use the secure button below to open your API account.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:700">Open API account</a></p><p>This link expires in ${expiresMinutes} minutes and can be used once.</p><p style="color:#64748b;font-size:13px">If you did not request this email, no action is required.</p></div></body></html>`;
      await sesClient.send(new SendEmailCommand({
        FromEmailAddress: sender,
        ...(replyTo ? { ReplyToAddresses: [replyTo] } : {}),
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: "Your SolveLang API sign-in link", Charset: "UTF-8" },
            Body: {
              Text: { Data: text, Charset: "UTF-8" },
              Html: { Data: html, Charset: "UTF-8" },
            },
          },
        },
      }));
    },
  };
}
