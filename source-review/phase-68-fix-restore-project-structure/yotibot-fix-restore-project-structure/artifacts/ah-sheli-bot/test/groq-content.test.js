import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const directory = await mkdtemp(path.join(tmpdir(), "ah-sheli-groq-content-"));
process.env.AH_SHELI_DATA_DIR = directory;
const [{ parseGroqContent }, { analyzeMessage, createGroqClient }, { handleAssistantMessage }, { createEmptyStore }] =
  await Promise.all([
    import("../src/groq-content.js"), import("../src/groq-assistant.js"),
    import("../src/assistant.js"), import("../src/store.js"),
  ]);
after(() => rm(directory, { recursive: true, force: true }));
const completion = (content, finish_reason = "stop", refusal = null) => ({
  choices: [{ finish_reason, message: { content, refusal } }],
});
const fakeClient = content => ({ complete: async () => completion(content) });

test("partial conversational JSON safely recovers reply without replay or mutations", async () => {
  const variants = [
    '{"type":"answer","reply":"בשמחה אחי, הנה הסבר על הירח."',
    '{"type":"answer","reply":"בשמחה אחי, הנה הסבר על הירח.',
    '```json\n{"reply":"בשמחה אחי, הנה הסבר על הירח.",}\n```',
    '{"type":"chat","reply":"בשמחה אחי, הנה הסבר על הירח."',
  ];
  for (const content of variants) {
    const intent = parseGroqContent(content, "למה הירח משנה צורה?");
    assert.equal(intent.type, "answer");
    assert.equal(intent.response, "בשמחה אחי, הנה הסבר על הירח.");
    const store = createEmptyStore();
    let calls = 0;
    const reply = await handleAssistantMessage(store, "owner", "למה הירח משנה צורה?",
      (message, context) => analyzeMessage(message, context, { complete: async request => {
        calls++;
        assert.match(request.messages[0].content, /שאלות כלליות ושיחות חולין/);
        return completion(content);
      } }));
    assert.equal(calls, 1);
    assert.equal(reply, intent.response);
    assert.deepEqual(store.reminders, []);
    assert.deepEqual(Object.keys(store.lists), []);
  }
});

test("partial chat recovery decodes escapes and rejects action fields or fake save claims", () => {
  const safe = parseGroqContent('{"reply":"שורה אחת\\n\\"ציטוט\\"', "ספר לי בדיחה");
  assert.equal(safe.response, 'שורה אחת\n"ציטוט"');
  for (const content of [
    '{"type":"reminder","reply":"סגור אחי","hour":8',
    '{"reply":"סגור אחי","items":["חלב"]',
    '{"reply":"סגור אחי","intent":{"type":"delete-list"',
    '{"type":"answer","reply":"שמרתי לך תזכורת חדשה"',
    '{"reply":{"text":"לא תשובת טקסט"',
    '{"reply":"תשובה ראשונה","reply":"תשובה שנייה"',
  ]) {
    const intent = parseGroqContent(content, "ספר לי בדיחה");
    assert.equal(intent.type, "clarify");
    assert.equal(intent.needsInterpretation, true);
  }
});

test("token-limited conversation envelopes can reply but incomplete actions cannot execute", async () => {
  const result = await analyzeMessage("מה ההבדל בין שמש לכוכב לכת?", {}, {
    complete: async () => completion('{"type":"answer","reply":"השמש היא כוכב, וכדור הארץ כוכב לכת.', "length"),
  });
  assert.equal(result.type, "answer");
  assert.equal(result.response, "השמש היא כוכב, וכדור הארץ כוכב לכת.");
  await assert.rejects(analyzeMessage("תוסיף חלב לקניות", {}, {
    complete: async () => completion('{"type":"add-items","listName":"קניות","items":["חלב"]}', "length"),
  }), error => error.code === "invalid_response");
});

test("completed natural conversation is a usable AI answer, not a local-mode error", async () => {
  const content = "בשמחה אחי, איך עובר עליך היום?";
  const reply = await handleAssistantMessage(createEmptyStore(), "chat", "היום היה עמוס",
    (text, context) => analyzeMessage(text, context, fakeClient(content)));
  assert.equal(reply, content);
  assert.doesNotMatch(reply, /מצב מקומי|לא הצלחתי לקרוא/u);
});

test("complete fenced and embedded JSON tolerate prose and escaped braces", () => {
  const payload = { type: "answer", response: 'דוגמה: {שם}, וגם "ציטוט".' };
  for (const content of [
    `\uFEFF\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
    `הנה התשובה:\n${JSON.stringify(payload)}\nסיימנו.`,
  ]) {
    assert.equal(parseGroqContent(content, "תן דוגמה").response, payload.response);
  }
});

test("minimal conversation objects, JSON strings and action aliases are accepted", () => {
  for (const content of ['{"response":"אהלן אחי"}', '{"message":"אהלן אחי"}', '"אהלן אחי"']) {
    assert.equal(parseGroqContent(content, "היי").response, "אהלן אחי");
  }
  const intent = parseGroqContent(
    '{"action":"add-items","listName":"קניות","items":["חלב"]}', "תוסיף חלב לקניות");
  assert.equal(intent.type, "add-items");
  assert.deepEqual(intent.items, ["חלב"]);
});

test("plain confirmations persist the entire requested list before replying", async () => {
  const store = createEmptyStore();
  const request = "תוסיף חלב, לחם וביצים לרשימת קניות";
  const reply = await handleAssistantMessage(store, "owner", request,
    (text, context) => analyzeMessage(text, context, fakeClient("סגור אחי, הוספתי הכול.")));
  assert.deepEqual(store.lists.owner["קניות"].map(item => item.text), ["חלב", "לחם", "ביצים"]);
  const saved = JSON.parse(await readFile(path.join(directory, "state.json"), "utf8"));
  assert.equal(saved.lists.owner["קניות"].length, 3);
  assert.match(reply, /קניות:[\s\S]*1\. 🥛 חלב[\s\S]*2\. 🍞 לחם[\s\S]*3\. 🥚 ביצים/u);
  assert.doesNotMatch(reply, /מצב מקומי|לא הצלחתי לקרוא/u);
  assert.deepEqual(store.reminders, []);
});

test("response-only JSON also executes a clear user list request, not an imaginary AI addition", () => {
  const intent = parseGroqContent('{"response":"הוספתי גם שמן."}', "תוסיף חלב לקניות");
  assert.equal(intent.type, "add-items");
  assert.deepEqual(intent.items, ["חלב"]);
});

test("list recovery never mistakes bread or another ל-prefixed item for the destination", () => {
  for (const request of ["תוסיף חלב, לחם וביצים לקניות", "תוסיף חלב, לחם וביצים לרשימת קניות"]) {
    const intent = parseGroqContent("סגור אחי, הוספתי.", request);
    assert.equal(intent.listName, "קניות");
    assert.deepEqual(intent.items, ["חלב", "לחם", "ביצים"]);
  }
});

test("plain text cannot invent saved records or silently execute an ambiguous request", () => {
  assert.equal(parseGroqContent("שמרתי לך תזכורת למחר.", "היי").type, "clarify");
  const intent = parseGroqContent("הוספתי הכול.", "אשמח שתוסיף דברים לרשימה");
  assert.equal(intent.type, "clarify");
  assert.match(intent.response, /עדיין לא שמרתי דבר/u);
  assert.deepEqual(intent.items, []);
});

test("a natural reply can recover a full explicit schedule, never the fixed background routine", () => {
  const request = "סידור עבודה בתאריך 2099-01-02:\n06:00 השכמה\n06:35 יציאה לאיסופים\n09:00 חזרה למשימות";
  const intent = parseGroqContent("סגור, סידרתי לך את היום.", request);
  assert.equal(intent.type, "schedule-reminders");
  assert.equal(intent.reminders.length, 3);
  assert.deepEqual(intent.reminders.map(item => [item.hour, item.minute]), [[6, 0], [6, 35], [9, 0]]);
  assert.equal(parseGroqContent("הלו״ז הקבוע כולל השכמה ויציאה לאיסופים.", "רק נתח את הלו״ז בלי תזכורות").type, "answer");
});

test("malformed, ambiguous and invalid action JSON still cannot trigger writes", () => {
  for (const content of [
    '{"type":"add-items","items":',
    '```json\n{"type":"add-items",}\n```',
    '{"type":"answer","response":"א"} {"type":"answer","response":"ב"}',
    '{"type":"reminder","text":"בנק","date":"2099-01-02","hour":25,"minute":0}',
    '{"type":"schedule-reminders","reminders":[{"text":"בנק","date":"2099-01-02","hour":10,"minute":60}]}',
    '{"type":"delete-all-records"}',
    '[{"type":"add-items","listName":"קניות","items":["חלב"]}',
    'הנה: {"type":"answer","response":"א"} {"type":"add-items","items":',
  ]) {
    const rejected = parseGroqContent(content, "בדיקה");
    assert.equal(rejected.type, "clarify");
    assert.deepEqual(rejected.items, []);
    assert.deepEqual(rejected.reminders, []);
    assert.equal(rejected.date, null);
    const fromUserOnly = parseGroqContent(content, "תוסיף חלב לקניות");
    assert.equal(fromUserOnly.type, "add-items");
    assert.equal(fromUserOnly.listName, "קניות");
    assert.deepEqual(fromUserOnly.items, ["חלב"]);
  }
});

test("truncated, empty and refused model replies are not accepted as completed chat", async () => {
  for (const result of [
    completion("הוספתי חלב", "length"),
    completion("הוספתי חלב", "stop", "refused"),
    completion("", "stop"),
  ]) {
    await assert.rejects(analyzeMessage("תוסיף חלב לקניות", {}, {
      complete: async () => result,
    }), error => error.code === "invalid_response");
  }
});

test("a refused HTTP JSON format retries once without it and never uses failed_generation", async () => {
  const requests = [];
  const client = createGroqClient({
    apiKey: "synthetic-key",
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      return requests.length === 1
        ? { ok: false, status: 400, json: async () => ({ error: {
            code: "json_validate_failed", failed_generation: "שמרתי תוכן שלא אושר",
          } }) }
        : { ok: true, status: 200, json: async () => completion("היי אחי, מה נשמע?") };
    },
  });
  const result = await client.complete({
    model: "openai/gpt-oss-20b",
    messages: [{ role: "user", content: "היי" }],
    max_tokens: 1024,
    response_format: { type: "json_object" },
  });
  const intent = parseGroqContent(result.choices[0].message.content, "היי");
  assert.equal(intent.type, "answer");
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].response_format, { type: "json_object" });
  assert.equal(requests[1].response_format, undefined);
  assert.equal(requests[1].max_tokens, requests[0].max_tokens);
  assert.deepEqual(requests[1].messages, requests[0].messages);
  assert.doesNotMatch(intent.response, /תוכן שלא אושר/u);
});

test("format recovery does not bypass the shared attempt or elapsed-time limits", async () => {
  let calls = 0, clock = 0;
  const client = createGroqClient({
    apiKey: "synthetic-key",
    requestOptions: { now: () => clock, totalBudgetMs: 2000 },
    fetchImpl: async () => {
      calls += 1;
      clock += 1100;
      return calls === 1
        ? { ok: false, status: 400, json: async () => ({ error: { code: "json_validate_failed" } }) }
        : { ok: true, status: 200, json: async () => completion("אהלן") };
    },
  });
  const request = {
    model: "openai/gpt-oss-20b",
    messages: [{ role: "user", content: "היי" }],
    response_format: { type: "json_object" },
  };
  await assert.rejects(client.complete(request), error => error.code === "unavailable");
  assert.equal(calls, 2);

  const refused = createGroqClient({
    apiKey: "synthetic-key",
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ error: { code: "json_validate_failed" } }) }),
  });
  await assert.rejects(analyzeMessage("היי", {}, refused), error => error.code === "invalid_response");
});
