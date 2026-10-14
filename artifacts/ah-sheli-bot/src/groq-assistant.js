import { AiServiceError, classifyAiError } from "./ai-errors.js";
import { promptForContext } from "./assistant-intent.js";
import { parseGroqContent, readGroqText } from "./groq-content.js";
import { createGroqRequest } from "./groq-requests.js";
import { modelContext, outputTokenBudget } from "./assistant-performance.js";

let sharedClient;
export const GROQ_MODEL = "openai/gpt-oss-20b";

// Direct Groq only. OPENAI_API_KEY is a legacy secret alias from the owner's
// supplied Groq script, not a second provider. Never expose its value in logs.
export function createGroqClient({
  apiKey = process.env.GROQ_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
  fetchImpl = globalThis.fetch,
  requestOptions = {},
} = {}) {
  if (!apiKey) throw new AiServiceError("missing_configuration");
  return {
    provider: "Groq",
    model: GROQ_MODEL,
    complete: createGroqRequest({
      ...requestOptions,
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      fetchImpl,
    }),
  };
}

export async function analyzeMessage(userMessage, context = {}, clientOverride) {
  if (typeof userMessage !== "string" || !userMessage.trim()) {
    throw new AiServiceError("invalid_request");
  }
  context ??= {};
  const client = clientOverride ?? (sharedClient ??= createGroqClient());
  const compactContext = modelContext(context);
  const { recentConversation, ...chatContext } = compactContext;
  const maxTokens = outputTokenBudget(userMessage, recentConversation);
  const started = performance.now();
  const messages = [
    { role: "system", content: promptForContext(context) },
    ...recentConversation.map(row => ({
      role: row.role, content: row.content ?? row.text,
    })),
    { role: "user", content: JSON.stringify({ currentMessage: userMessage, chatContext }) },
  ];
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      let completion;
      try {
        completion = await client.complete({
          model: client.model ?? GROQ_MODEL,
          reasoning_effort: "low",
          messages: attempt === 0 ? messages : [
            ...messages.slice(0, -1),
            { role: "system", content: "פענח מחדש רק את currentMessage וההקשר השמור. אין צורך בניסוח קבוע מצד המשתמש. החזר JSON תקין עם type ושדות הפעולה הרלוונטיים. פריט כמו שמנת הוא add-items; מחיקה שהובנה מההודעה היא delete-list/clear-list/remove-range. אל תמציא אישור שמירה ואל תבצע בקשות ישנות. שאל רק על מידע שבאמת חסר. אל תשחזר שדות מתשובת המודל הקודמת." },
            messages.at(-1),
          ],
          // Let completed natural replies reach our tolerant parser. Provider
          // JSON enforcement can reject generation before we can interpret it.
          max_tokens: attempt === 0 ? maxTokens : Math.max(maxTokens, 1024),
          temperature: 0,
        });
      } catch (error) {
        const classified = classifyAiError(error);
        if (attempt === 0 && classified.code === "invalid_response") continue;
        throw classified;
      }
      const choice = completion?.choices?.[0];
      const content = readGroqText(choice?.message?.content);
      if (choice?.message?.refusal) throw new AiServiceError("invalid_response");
      const partialChat = choice?.finish_reason === "length" && typeof content === "string"
        && /^\s*(?:\{|```json\b)/u.test(content);
      if ((!partialChat && choice?.finish_reason !== "stop")
        || typeof content !== "string" || !content.trim()) {
        if (attempt === 0) continue;
        throw new AiServiceError("invalid_response");
      }
      const intent = parseGroqContent(content, userMessage, context.lastConfirmedListAction);
      // A token-limited envelope may yield readable chat, never a completed write.
      if (partialChat && (intent.type !== "answer" || intent.needsInterpretation)) {
        if (attempt === 0) continue;
        throw new AiServiceError("invalid_response");
      }
      if (intent.needsInterpretation && attempt === 0) continue;
      const { needsInterpretation, ...result } = intent;
      return result;
    }
  } catch (error) {
    throw classifyAiError(error);
  } finally {
    console.info(`[Ah Sheli] ${client.provider ?? "Groq"} timing model=${client.model ?? GROQ_MODEL} ms=${Math.round(performance.now() - started)} maxTokens=${maxTokens} historyMessages=${recentConversation.length}`);
  }
}
