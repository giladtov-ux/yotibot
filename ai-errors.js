const messages = {
  quota_exhausted: "אחי, הגעתי כרגע למגבלת השימוש. אפשר לנסות שוב מאוחר יותר.",
  authentication_failed: "אחי, החיבור שלי צריך תיקון כרגע. אני כאן, אבל לא שיניתי דבר בעקבות הבקשה הזו.",
  missing_configuration: "אחי, החיבור שלי עדיין לא מוכן. אני כאן, אבל לא שיניתי דבר בעקבות הבקשה הזו.",
  rate_limited: "אחי, יש קצת עומס כרגע. אפשר לנסות שוב בעוד רגע.",
  unavailable: "אחי, יש כרגע עיכוב בחיבור. אפשר לנסות שוב בעוד רגע.",
  invalid_response: "אחי, לא קיבלתי תשובה מלאה מספיק כדי לבצע את הבקשה. לא שמרתי או מחקתי דבר על סמכה.",
  invalid_request: "אחי, התשובה מתעכבת לי הפעם. אפשר לנסות שוב בעוד רגע; לא שיניתי דבר.",
  model_unavailable: "אחי, החיבור שלי לא זמין כרגע וצריך תיקון. אני כאן, אבל לא שיניתי דבר בעקבות הבקשה הזו.",
};

export class AiServiceError extends Error {
  constructor(code, { retryable = false, retryAfterMs = null, status = null } = {}) {
    super(messages[code] ?? messages.unavailable);
    this.name = "AiServiceError";
    this.code = code;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export function classifyAiError(error) {
  if (error instanceof AiServiceError) return error;
  const status = error?.status;
  const code = error?.code ?? error?.error?.code;
  if (status === 401 || status === 403
    || code === "invalid_api_key") {
    return new AiServiceError("authentication_failed", { status: status ?? null });
  }
  if (status === 429) {
    const quota = ["insufficient_quota", "billing_hard_limit_reached"].includes(code)
      || error?.type === "insufficient_quota";
    return new AiServiceError(quota ? "quota_exhausted" : "rate_limited", {
      status, retryAfterMs: error?.retryAfterMs ?? null,
      retryable: !quota,
    });
  }
  if (code === "json_validate_failed") return new AiServiceError("invalid_response", { status: status ?? null });
  if (status === 400) return new AiServiceError("invalid_request", { status });
  if (status === 404) return new AiServiceError("model_unavailable", { status });
  // Never copy a provider's raw error into a Telegram reply or application log:
  // authentication responses can contain portions of the rejected credential.
  return new AiServiceError("unavailable", {
    status: status ?? null,
    retryable: status == null || [408, 500, 502, 503, 504].includes(status),
    retryAfterMs: error?.retryAfterMs ?? null,
  });
}
