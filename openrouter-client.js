import { AiServiceError } from "./ai-errors.js";
import { createGroqRequest } from "./groq-requests.js";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function createOpenRouterClient({
  apiKey = process.env.OPENROUTER_API_KEY?.trim(),
  model = process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-4o-mini",
  fetchImpl = globalThis.fetch,
  requestOptions = {},
} = {}) {
  if (!apiKey) throw new AiServiceError("missing_configuration");
  const request = createGroqRequest({
    ...requestOptions,
    provider: "OpenRouter",
    url: OPENROUTER_URL,
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    fetchImpl,
  });
  return {
    provider: "OpenRouter",
    model,
    complete(body) {
      // These Groq-specific/structured-output options are not part of chat.
      const { reasoning_effort, response_format, ...options } = body;
      return request({ ...options, model, stream: false });
    },
  };
}
