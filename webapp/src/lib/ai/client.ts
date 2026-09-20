// Server-only client for the local OmniRoute AI gateway. OmniRoute fans a
// single request out to whichever upstream provider (Anthropic, OpenAI, ...)
// is configured, with automatic fallback -- this app never talks to a
// provider directly. Never import this from a "use client" component: the
// key lives in OMNIROUTE_API_KEY, a server-only env var.

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
}

interface ChatResult {
  text: string;
  model: string;
}

export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResult> {
  const baseUrl = process.env.OMNIROUTE_BASE_URL;
  const apiKey = process.env.OMNIROUTE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("OMNIROUTE_BASE_URL / OMNIROUTE_API_KEY are not set");
  }

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: options.model ?? "auto",
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OmniRoute request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return {
    text: data.choices?.[0]?.message?.content ?? "",
    model: data.model,
  };
}
