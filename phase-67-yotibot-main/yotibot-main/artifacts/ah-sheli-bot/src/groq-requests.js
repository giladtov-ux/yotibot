import { setTimeout as delay } from "node:timers/promises";
import { AiServiceError, classifyAiError } from "./ai-errors.js";
import { validateGroqBody } from "./groq-message-schema.js";

function retryDelay(response, now) {
  const header = response.headers?.get?.("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.min(milliseconds, 86_400_000) : null;
}

export function createGroqRequest({
  url, headers, fetchImpl = globalThis.fetch, provider = "Groq",
  now = Date.now, sleep = delay, random = Math.random,
  totalBudgetMs = null, attemptTimeoutMs = null, maxAttempts = 3,
}) {
  let blockedUntil = 0;
  let blockedError;
  return async function complete(body) {
    const validatedBody = validateGroqBody(body);
    if (now() < blockedUntil) throw blockedError;
    const bulk = body?.max_tokens > 2048;
    const deadline = now() + (totalBudgetMs ?? (bulk ? 18_000 : 12_000));
    const requestTimeout = attemptTimeoutMs ?? (bulk ? 12_000 : 8_000);
    let lastError = new AiServiceError("unavailable", { retryable: true });
    let requestBody = validatedBody;
    let usedFormatRecovery = false;
    for (let attempt = 0; attempt < maxAttempts && now() < deadline; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          method: "POST", headers, body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(Math.max(1,
            Math.floor(Math.min(requestTimeout, deadline - now())))),
        });
        let payload;
        try {
          payload = await response.json();
        } catch {
          throw response.ok
            ? new AiServiceError("invalid_response")
            : classifyAiError({ status: response.status, retryAfterMs: retryDelay(response, now()) });
        }
        if (now() >= deadline) throw new AiServiceError("unavailable", { retryable: true });
        if (!response.ok || payload?.error) {
          if (response.status === 400 && payload?.error?.code === "json_validate_failed"
            && requestBody?.response_format && !usedFormatRecovery
            && attempt + 1 < maxAttempts) {
            // Ignore failed_generation: it is neither a completed reply nor a
            // validated action. Re-request once within the same time/try budget.
            usedFormatRecovery = true;
            requestBody = { ...requestBody };
            delete requestBody.response_format;
            console.warn(`[Ah Sheli] ${provider} format recovery: retrying without response_format.`);
            continue;
          }
          throw classifyAiError({
            status: !response.ok ? response.status
              : (Number(payload?.error?.code) || 502),
            code: payload?.error?.code,
            type: payload?.error?.type,
            retryAfterMs: retryDelay(response, now()),
          });
        }
        blockedUntil = 0;
        return payload;
      } catch (error) {
        lastError = classifyAiError(error);
        console.warn(`[Ah Sheli] ${provider} attempt=${attempt + 1} status=${lastError.status ?? "network"} code=${lastError.code} retryable=${lastError.retryable}`);
        if (!lastError.retryable || attempt + 1 >= maxAttempts) break;
        const wait = lastError.retryAfterMs ?? (500 * 2 ** attempt + Math.floor(random() * 250));
        if (wait >= deadline - now()) break;
        await sleep(wait);
      }
    }
    if (["quota_exhausted", "rate_limited", "unavailable"].includes(lastError.code)) {
      blockedUntil = now() + Math.max(1000,
        lastError.retryAfterMs ?? (lastError.code === "unavailable" ? 10_000 : 60_000));
      blockedError = lastError;
    }
    throw lastError;
  };
}
