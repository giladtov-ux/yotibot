import { AiServiceError } from "./ai-errors.js";

// This bot is text-only: it uses no tools, images or tool_call_id messages.
// https://console.groq.com/docs/api-reference#chat-create
export function validateGroqBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)
    || typeof body.model !== "string" || !body.model.trim()
    || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new AiServiceError("invalid_request");
  }
  const messages = body.messages.map(message => {
    if (!message || typeof message !== "object" || Array.isArray(message)
      || !["system", "user", "assistant"].includes(message.role)
      || typeof message.content !== "string" || !message.content.trim()) {
      throw new AiServiceError("invalid_request");
    }
    // Never send stored-row metadata, legacy text fields or unknown roles.
    return { role: message.role, content: message.content };
  });
  return { ...body, messages };
}
