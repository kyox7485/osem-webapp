"use server";

// Set TELEGRAM_BOT_TOKEN in env. Chat IDs are stored per-branch in tbl_branches.telegram_chat_id.
export async function sendTelegramMessage(text: string, chatId: string | null | undefined): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token || !chatId) {
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[Telegram] API error ${res.status}: ${body}`);
    }
  } catch (err) {
    // Never let a notification failure break the main save flow
    console.error("[Telegram] Failed to send notification:", err);
  } finally {
    clearTimeout(timer);
  }
}
