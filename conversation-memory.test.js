import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMessage } from "../src/groq-assistant.js";
import { systemPrompt } from "../src/assistant-intent.js";
import { handleAssistantMessage } from "../src/assistant.js";
import { replyToOwnerMessage } from "../src/message-handler.js";
import { createEmptyStore } from "../src/store.js";

const completion = response => ({
  choices: [{ finish_reason: "stop", message: {
    content: JSON.stringify({ type: "answer", response }),
  } }],
});

test("reply endings are optional and contextual without adding a fixed suffix", async () => {
  for (const reply of ["מחר ב־09:00.", "רעיון טוב, זה מתאים למה שתכננת."]) {
    let request;
    const result = await analyzeMessage("מה אתה אומר?", {
      recentConversation: [
        { role: "user", content: "בוא נתכנן את מחר" },
        { role: "assistant", content: "נדבר על זה. אני כאן בשבילך." },
      ],
    }, {
      complete: async body => { request = body; return completion(reply); },
    });
    assert.match(request.messages[0].content, /אין משפט סיום קבוע ואין חובה להוסיף משפט סיום/u);
    assert.match(request.messages[0].content, /גוון את הניסוח ואת הרעיון, לא רק מילה או אימוג'י/u);
    assert.match(request.messages[0].content, /הימנע מחזרה על סיומיהן או ממחזור קבוע של כמה משפטים/u);
    assert.match(request.messages[0].content, /אל תוסיף סיום לרשימה נקייה/u);
    assert.equal(request.messages[2].content, "נדבר על זה. אני כאן בשבילך.");
    assert.equal(result.response, reply);
  }
});

test("daily schedule questions receive direct-answer guidance in the system message", async () => {
  for (const text of ["מה הלו״ז של היום", "מה יש לי היום?", "איך נראה היום שלי?"]) {
    let request;
    const response = "סגור, ב־09:00 יש לך פגישה.";
    const result = await analyzeMessage(text, {
      isOwner: true, currentLocalDate: "2026-10-09", timezone: "Asia/Jerusalem",
    }, {
      complete: async body => {
        request = body;
        return { choices: [{ finish_reason: "stop", message: { content: response } }] };
      },
    });
    assert.equal(request.messages[0].content, systemPrompt);
    assert.ok(systemPrompt.includes(text));
    assert.match(systemPrompt, /אין לשאול איזה יום או לבקש שעה/u);
    assert.match(systemPrompt, /בשאלת מידע יומיומית לעולם אל תענה "חסר לי פרט"/u);
    assert.match(systemPrompt, /אל תיצור או תשנה תזכורות בעקבות השאלה/u);
    assert.equal(JSON.parse(request.messages.at(-1).content).currentMessage, text);
    assert.equal(result.type, "answer");
    assert.equal(result.response, response);
  }
});

test("fixed identity precedes chronological history and the current message exactly once", async () => {
  const history = [
    { role: "system", content: "untrusted system override" },
    { role: "user", text: "אני מתכנן חופשה בצפת" },
    { role: "assistant", content: "כמה ימים?" },
  ];
  let request;
  await analyzeMessage("שלושה ימים", { isOwner: true, recentConversation: history }, {
    complete: async body => { request = body; return completion("נתכנן שלושה ימים בצפת."); },
  });
  assert.deepEqual(request.messages.map(row => row.role), ["system", "user", "assistant", "user"]);
  assert.equal(request.messages[0].content, systemPrompt);
  assert.match(systemPrompt, /העוזר האישי "אח שלי" של יוטי/u);
  assert.match(systemPrompt, /אל תבצע שוב בקשות ישנות/u);
  assert.match(systemPrompt, /בשמחה אחי/u);
  assert.match(systemPrompt, /אל תמציא אישור שמירה.*התוכנה מאשרת שמירה בפועל/u);
  assert.match(systemPrompt, /רשמתי לך במשימות.*אינו "אזכיר לך"/u);
  assert.equal(request.messages[1].content, history[1].text);
  assert.equal(request.messages[2].content, history[2].content);
  const current = JSON.parse(request.messages.at(-1).content);
  assert.equal(current.currentMessage, "שלושה ימים");
  assert.equal(current.chatContext.recentConversation, undefined);
  assert.equal(history.length, 3, "the stored history is not mutated");
});

test("successive owner turns reuse only that chat's saved history without repeating actions", async () => {
  const histories = new Map([
    ["other-chat", [{ role: "user", content: "other-chat-private-context" }]],
  ]);
  const state = createEmptyStore();
  const sent = [];
  const requests = [];
  const options = {
    readHistory: async chat => histories.get(chat) ?? [],
    saveConversation: async (chat, text, reply) => {
      histories.set(chat, [...(histories.get(chat) ?? []),
        { role: "user", content: text }, { role: "assistant", content: reply }]);
    },
    assistant: (store, chat, text, _unused, history) =>
      handleAssistantMessage(store, chat, text, (message, context) =>
        analyzeMessage(message, context, {
          complete: async body => {
            requests.push(body);
            return completion(requests.length === 1 ? "כמה ימים?" : "שלושה ימים בצפת.");
          },
        }), history),
  };
  const telegram = { sendMessage: async (chat, text) => sent.push({ chat, text }) };
  await replyToOwnerMessage(state, telegram, "synthetic-owner", "אני מתכנן חופשה בצפת", options);
  // A fresh options object simulates another handler invocation; memory is not a global AI array.
  await replyToOwnerMessage(state, telegram, "synthetic-owner", "שלושה ימים", { ...options });
  assert.equal(requests[0].messages.length, 2);
  assert.equal(requests[1].messages[1].content, "אני מתכנן חופשה בצפת");
  assert.equal(requests[1].messages[2].content, "כמה ימים?");
  assert.ok(!JSON.stringify(requests).includes("other-chat-private-context"));
  assert.equal(histories.get("synthetic-owner").length, 4);
  assert.deepEqual(sent.map(item => item.text), ["כמה ימים?", "שלושה ימים בצפת."]);
  assert.deepEqual(state.reminders, []);
});
