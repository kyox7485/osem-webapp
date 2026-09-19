"use server";

// Scaffold: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env.local
// to activate notifications. See README for setup instructions.
export async function sendTelegramMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    // Silently skip -- bot not configured yet
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch {
    // Never let a notification failure break the main save flow
    console.error("[Telegram] Failed to send notification");
  }
}
