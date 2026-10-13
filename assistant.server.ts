import { analyzeMessage, createGroqClient } from "./groq-assistant.js";
import { createOpenRouterClient } from "./openrouter-client.js";
import { parseWeeklySchedule, saveWeeklySchedule } from "./weekly-schedules.js";

let sharedClient;

export function createAssistantClient() {
  if (process.env.OPENROUTER_API_KEY?.trim()) return createOpenRouterClient();
  // Preserve the working bot during credential setup, never fail over from an
  // authenticated OpenRouter client to another provider after a request error.
  console.warn("[Ah Sheli] OpenRouter is not configured; retaining the existing Groq connection.");
  return createGroqClient();
}

export async function askAssistant(userMessage, context = {}, clientOverride) {
  const client = clientOverride ?? (sharedClient ??= createAssistantClient());
return analyzeMessage(userMessage, context, client);
}


