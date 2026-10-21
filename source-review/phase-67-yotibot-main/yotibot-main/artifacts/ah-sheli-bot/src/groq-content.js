import { AiServiceError } from "./ai-errors.js";
import { normalizeIntent, allowedTypes } from "./assistant-intent.js";
import { parseNaturalIntent } from "./natural-language.js";
import { parseScheduleFallback } from "./schedule-fallback.js";
import { parseListContinuation } from "./list-continuation.js";
import { isScheduleInformationRequest } from "./schedule-queries.js";

const recoverableTypes = new Set([
  "add-items", "add-task", "create-list", "show-list", "list-lists",
  "list-reminders", "mark-item", "remove-item", "update-item", "cancel-reminder",
  "cancel-reminder-number",
  "delete-list", "clear-list", "remove-range",
]);
const analysisOnly = /(?:בלי\s+(?:לשמור|תזכורות|התראות)|אל\s+תשמור|לא\s+לשמור|רק\s+(?:נתח|הצג|תציג)|(?:ניתוח|הצגה)\s+בלבד|לדוגמה|דוגמה|ציטוט|מה\s+דעתך|האם)/u;
const actionRequest = /^(?:בבקשה\s+)?(?:תוסיף|הוסף|הוסיפי|תכניס|תוסיפי|שמור|תשמור|זכור|תזכור|צור|תיצור|תכין|הכן|פתח|תפתח|מחק|תמחק|הסר|תסיר|סמן|תסמן|תזכיר|קבע|תבטל|בטל|אשמח\s+שתוסיף)(?=\s|$)/u;
const actionClaim = /הוספתי|שמרתי|רשמתי|מחקתי|הסרתי|סימנתי|ביטלתי|פתחתי.*רשימ|קבעתי.*(?:תזכורת|התראה)|תזכורת.*(?:נקבעה|נשמרה)|אזכיר\s+לך|אשלח\s+לך.*(?:תזכורת|התראה)/u;
const clarification = response => normalizeIntent({ type: "clarify", response });
const normalizeRecovered = intent => {
  try { return normalizeIntent(intent); }
  catch { return clarification("אחי, הפרטים לא מתאימים לשמירה בטוחה. לא שמרתי דבר; כתוב את שם הרשימה והפריטים בבירור."); }
};

function recoverUserAction(userMessage, lastListAction) {
  if (analysisOnly.test(userMessage) || isScheduleInformationRequest(userMessage)) return null;
  const continuation = parseListContinuation(userMessage, lastListAction);
  if (continuation) {
    const recovered = normalizeRecovered(continuation);
    return recovered.type === "clarify" ? { ...recovered, needsInterpretation: true } : recovered;
  }
  // Never extract saved items or times from the model's prose or earlier turns.
  let local;
  try { local = parseNaturalIntent(userMessage, new Date(Date.now())); }
  catch { return clarification("חסר לי פרט ברור כדי לבצע את זה בלי לנחש. מה בדיוק לשמור ובאיזה מועד? עדיין לא שמרתי דבר."); }
  if (local && recoverableTypes.has(local.type)) return normalizeRecovered(local);
  let schedule;
  try { schedule = parseScheduleFallback(userMessage); }
  catch { return clarification("יש פרט זמן שלא אוכל לפענח בבטחה. לא קבעתי תזכורות; אפשר לחדד את היום והשעה?"); }
  if (schedule?.type === "schedule-reminders") return normalizeRecovered(schedule);
  if (schedule?.type === "clarify" || actionRequest.test(userMessage)
    || local?.type === "reminder" || local?.type === "repeat-reminder") {
    return { ...clarification("חסר לי פרט כדי להשלים את הבקשה; עדיין לא שמרתי דבר."),
      needsInterpretation: true };
  }
  return null;
}

function naturalReply(response, userMessage, lastListAction) {
  if (typeof response !== "string" || !response.trim()) {
    throw new AiServiceError("invalid_response");
  }
  if (response.length > 64000) return clarification("התשובה ארוכה מדי לשליחה אחת. לא ביצעתי פעולה על סמכה; אפשר למקד את הבקשה?");
  const action = recoverUserAction(userMessage, lastListAction);
  if (action) return action;
  const unquoted = response.replace(/```[\s\S]*?```|“[^”]*”|״[^״]*״|"[^"]*"|'[^']*'/gu, "")
    .replace(/(?:עדיין\s+)?(?:לא|טרם)\s+(?:שמרתי|הוספתי|מחקתי|קבעתי|יצרתי|רשמתי)/gu, "");
  if (actionClaim.test(unquoted)) {
    return { ...clarification("אני כאן אחי. לא שמרתי או שיניתי דבר בהודעה הזו."),
      needsInterpretation: true };
  }
  return normalizeIntent({ type: "answer", response: response.trim() });
}

function normalizePayload(payload, userMessage, lastListAction) {
  if (typeof payload === "string") return naturalReply(payload, userMessage, lastListAction);
  if (typeof payload === "number" || typeof payload === "boolean") return naturalReply(String(payload), userMessage, lastListAction);
  if (Array.isArray(payload) && readGroqText(payload)) return naturalReply(readGroqText(payload), userMessage, lastListAction);
  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    throw new AiServiceError("invalid_response");
  }
  if (payload.intent && !payload.type) return normalizePayload(payload.intent, userMessage, lastListAction);
  if (!payload.type && allowedTypes.has(payload.action)) {
    payload = { ...payload, type: payload.action };
  }
  const response = readGroqText(payload.response) ?? readGroqText(payload.message)
    ?? readGroqText(payload.content) ?? readGroqText(payload.text)
    ?? readGroqText(payload.reply) ?? readGroqText(payload.answer) ?? readGroqText(payload.output);
  if ((["answer", "chat", "conversation", "message", "text", "reply"].includes(payload.type)
    || (payload.type && !allowedTypes.has(payload.type))) && response) {
    // Conversational output does not need hour/items/etc. Unrelated invalid
    // action fields must not turn a perfectly readable reply into an error.
    return naturalReply(response, userMessage, lastListAction);
  }
  if (["clarify", "greeting", "thanks", "farewell", "small-talk"].includes(payload.type) && response) {
    return normalizeIntent({ type: payload.type, response });
  }
  if (!payload.type) {
    if (typeof response === "string") return naturalReply(response, userMessage, lastListAction);
    const action = recoverUserAction(userMessage, lastListAction);
    if (action) return action;
  }
  // Missing optional fields already have null/empty-array defaults. Invalid
  // dates, counts and actions still fail validation; prose never repairs them.
  const intent = normalizeIntent(payload);
  return intent.type === "answer" ? naturalReply(intent.response, userMessage, lastListAction) : intent;
}

export function readGroqText(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length && value.every(block =>
    typeof block === "string" || (block?.type === "text" && typeof block.text === "string"))) {
    return value.map(block => typeof block === "string" ? block : block.text).join("\n");
  }
  if (value && !Array.isArray(value) && typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.content === "string") return value.content;
  }
  return null;
}

function embeddedObjects(text) {
  const objects = [];
  let start = -1, depth = 0, quoted = false, escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (start < 0) {
      if (character === "{") { start = index; depth = 1; }
      continue;
    }
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      const fragment = text.slice(start, index + 1);
      try { objects.push(JSON.parse(fragment)); }
      catch {
        if (/"(?:type|action|intent|items|reminders)"\s*:/u.test(fragment)) {
          throw new AiServiceError("invalid_response");
        }
      }
      start = -1;
    }
  }
  if (start >= 0 && /"(?:type|action|intent|items|reminders)"\s*:/u.test(text.slice(start))) {
    throw new AiServiceError("invalid_response");
  }
  return objects.filter(object => object && typeof object === "object"
    && ["type", "action", "intent", "response", "message", "content"].some(key => Object.hasOwn(object, key)));
}

// Recover only flat conversation envelopes, never truncated action payloads.
// Quoted text is decoded as JSON so braces, escapes and code in a reply stay text.
function recoverConversationEnvelope(text, userMessage, lastListAction) {
  if (!text.startsWith("{") || text.length > 64000) return null;
  const chatTypes = new Set(["answer", "chat", "conversation", "message", "text",
    "reply", "greeting", "thanks", "farewell", "small-talk"]);
  const replyKeys = new Set(["reply", "response", "answer", "message", "content", "text", "output"]);
  const fields = new Map();
  let index = 1;
  const whitespace = () => { while (/\s/u.test(text[index] ?? "") && index < text.length) index++; };
  const quoted = allowPartial => {
    if (text[index] !== '"') return null;
    const start = index++;
    let escaped = false;
    while (index < text.length) {
      const character = text[index++];
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') {
        try { return JSON.parse(text.slice(start, index)); } catch { return null; }
      }
    }
    if (!allowPartial) return null;
    // Drop an unfinished escape, not the already decoded reply.
    let fragment = text.slice(start + 1);
    if (escaped) fragment = fragment.slice(0, -1);
    fragment = fragment.replace(/\\u[0-9a-f]{0,3}$/iu, "");
    try { return JSON.parse(`"${fragment}"`); } catch { return null; }
  };
  while (index < text.length) {
    whitespace();
    if (text[index] === "}") {
      index++;
      whitespace();
      if (index !== text.length) return null;
      break;
    }
    const key = quoted(false);
    if (key === null || fields.has(key) || (key !== "type" && !replyKeys.has(key))) return null;
    whitespace();
    if (text[index++] !== ":") return null;
    whitespace();
    const value = quoted(replyKeys.has(key));
    if (value === null || (key === "type" && !chatTypes.has(value))) return null;
    fields.set(key, value);
    whitespace();
    if (text[index] === ",") index++;
    else if (index < text.length && text[index] !== "}") return null;
  }
  const reply = [...replyKeys].map(key => fields.get(key)).find(value => value?.trim());
  return reply ? naturalReply(reply, userMessage, lastListAction) : null;
}

export function parseGroqContent(content, userMessage, lastListAction = null) {
  if (typeof content !== "string" || !content.trim()) throw new AiServiceError("invalid_response");
  const original = content.trim().replace(/^\uFEFF/u, "");
  const fence = /^```([a-z0-9_-]*)\s*\n?([\s\S]*?)\s*```$/iu.exec(original);
  const text = fence ? fence[2].trim() : original;
  try {
    let payload, format;
    try { payload = JSON.parse(text); format = fence ? "fenced-json" : "json"; }
    catch {
      const conversation = recoverConversationEnvelope(text, userMessage, lastListAction);
      if (conversation) return conversation;
      if (text.startsWith("{") && /"(?:reply|response|answer|message|content|text|output)"\s*:/u.test(text)) {
        throw new AiServiceError("invalid_response");
      }
      const actionJson = /"(?:type|action|intent|items|reminders)"\s*:/u.test(text);
      if ((fence || /^[{[]/u.test(text)) && actionJson) throw new AiServiceError("invalid_response");
      if (fence && !actionJson) return naturalReply(original, userMessage, lastListAction);
      const candidates = embeddedObjects(text);
      if (candidates.length > 1) throw new AiServiceError("invalid_response");
      if (candidates.length === 1) { payload = candidates[0]; format = "embedded-json"; }
      else {
        // Never reinterpret truncated or malformed action JSON as a chat reply.
        if (/"(?:type|items|reminders)"\s*:/u.test(text)) {
          throw new AiServiceError("invalid_response");
        }
        console.info("[Ah Sheli] Groq content recovered format=plain-text");
        return naturalReply(text, userMessage, lastListAction);
      }
    }
    const intent = normalizePayload(payload, userMessage, lastListAction);
    if (format !== "json") console.info(`[Ah Sheli] Groq content recovered format=${format}`);
    return intent;
  } catch {
    console.warn("[Ah Sheli] Groq content rejected reason=invalid_structure_or_fields");
    // Completed malformed output is not a connection failure. Only a clear
    // current user instruction may supply a replacement action; never the bad
    // model fields. Otherwise ask for clarity without switching providers/modes.
    const recovered = recoverUserAction(userMessage, lastListAction);
    return recovered ?? { ...clarification("אחי, התשובה נקטעה לי הפעם. אפשר לנסות שוב בעוד רגע; לא שיניתי דבר."),
      needsInterpretation: true };
  }
}
