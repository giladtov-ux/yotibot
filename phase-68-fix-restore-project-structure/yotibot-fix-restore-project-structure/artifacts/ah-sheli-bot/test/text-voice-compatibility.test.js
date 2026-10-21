import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createEmptyStore } from "../src/store.js";
import { handleOwnerUpdate } from "../src/message-handler.js";
import { recordMenuForRequest } from "../src/record-menu.js";
import { menuDelivery } from "../src/menu-delivery.js";
import { reminderValidationTime } from "../src/time.js";

const owner = "42";
function fixture() {
  const store = createEmptyStore();
  store.lists[owner] = {
    קניות: [{ id: "milk", text: "חלב", checked: false }],
    משימות: [{ id: "bill", text: "לשלם חשבון", checked: true }],
  };
  store.lists["99"] = { קניות: [{ id: "other", text: "פריט של משתמש אחר", checked: false }] };
  store.reminders = [{
    id: "wake", chatId: owner, text: "השכמה", dueAt: 1_900_000_000_000,
    sentAt: null, repeatEveryMs: 86_400_000,
  }];
  store.savedSchedules = [{ chatId: owner, source: "לו״ז מקורי", entries: [{ reminderId: "wake" }] }];
  return store;
}

function update(text) {
  return {
    update_id: 91,
    message: {
      message_id: 12, date: 1_800_000_000,
      from: { id: 42 }, chat: { id: 42, type: "private" },
      ...(text === undefined ? { voice: { file_id: "voice", duration: 2 } } : { text }),
    },
  };
}

test("ordinary text starts and replies even when the entire voice module cannot load", () => {
  const script = `
    import assert from "node:assert/strict";
    import { registerHooks } from "node:module";
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier.includes("voice-transcription")) throw new Error("speech module unavailable");
        return nextResolve(specifier, context);
      },
    });
    globalThis.fetch = () => assert.fail("text must not contact a speech service");
    const { handleOwnerUpdate } = await import(${JSON.stringify(new URL("../src/message-handler.js", import.meta.url).href)});
    const { createEmptyStore } = await import(${JSON.stringify(new URL("../src/store.js", import.meta.url).href)});
    const sent = [];
    await handleOwnerUpdate(createEmptyStore(), { sendMessage: async (...args) => sent.push(args) },
      ${JSON.stringify(update("שלום אח שלי"))}, {
        ownerChatId: "42",
        replyOptions: {
          readHistory: async () => [],
          saveConversation: async () => {},
          assistant: async () => "אהלן, מה שלומך?",
        },
      });
    assert.deepEqual(sent, [["42", "אהלן, מה שלומך?"]]);
  `;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("written text has priority over an audio attachment and retains the original clock and history", async () => {
  const store = fixture();
  const before = JSON.stringify(store);
  const incoming = update("שלום אח שלי");
  incoming.message.voice = { file_id: "unused-recording" };
  const sent = [], turns = [];
  const history = [{ role: "user", content: "הקשר קודם" }];
  await handleOwnerUpdate(store, { sendMessage: async (...args) => sent.push(args) }, incoming, {
    ownerChatId: owner,
    transcribeVoice: async () => assert.fail("a written message must bypass transcription"),
    replyOptions: {
      readHistory: async () => history,
      saveConversation: async (...args) => turns.push(args),
      assistant: async (state, chat, text, _unused, prior) => {
        assert.equal(state, store);
        assert.equal(text, incoming.message.text);
        assert.equal(chat, owner);
        assert.deepEqual(prior, history);
        assert.equal(reminderValidationTime(), incoming.message.date * 1000);
        return "אהלן אח שלי";
      },
    },
  });
  assert.deepEqual(sent, [[owner, "אהלן אח שלי"]]);
  assert.deepEqual(turns, [[owner, incoming.message.text, "אהלן אח שלי"]]);
  assert.equal(JSON.stringify(store), before);
});

test("failed voice cannot erase existing records or prevent subsequent written list and summary menus", async () => {
  const store = fixture();
  const before = JSON.stringify(store);
  const sent = [], turns = [];
  const telegram = { sendMessage: async (...args) => sent.push(args) };
  assert.deepEqual(await handleOwnerUpdate(store, telegram, update(), {
    ownerChatId: owner,
    transcribeVoice: async () => { throw new Error("speech service unavailable"); },
    replyOptions: {
      assistant: async () => assert.fail("failed transcription cannot run actions"),
      saveConversation: async () => assert.fail("failed transcription cannot save a false turn"),
    },
  }), { transcriptionFailed: true });
  assert.equal(JSON.stringify(store), before);
  sent.length = 0;
  for (const text of ["/show קניות", "/show משימות", "/lists", "מה סיכום השבוע"]) {
    const expected = recordMenuForRequest(store, owner, text);
    const start = sent.length;
    assert.ok(expected);
    await handleOwnerUpdate(store, telegram, update(text), {
      ownerChatId: owner,
      transcribeVoice: async () => assert.fail("text must not depend on the broken speech service"),
      replyOptions: {
        readHistory: async () => [],
        readSummaryHistory: async () => ({
          rows: [{ user_text: "סיימתי לשלם את החשבון", assistant_text: "סגור" }],
        }),
        saveConversation: async (...args) => turns.push(args),
        assistant: async (_state, _chat, request, _unused, history) => {
          if (request === "מה סיכום השבוע") {
            assert.equal(history.rows[0].user_text, "סיימתי לשלם את החשבון");
          }
          return "הסיכום נשמר בדיוק כמו קודם";
        },
      },
    });
    const plan = menuDelivery(expected, "הסיכום נשמר בדיוק כמו קודם", { summary: text === "מה סיכום השבוע" });
    assert.deepEqual(sent[start], [owner, ...plan[0]]);
    assert.equal(sent.length - start, plan.length);
    assert.equal(JSON.stringify(store), before, "read-only text menus preserve all owners' existing data");
  }
  assert.equal(turns.length, 4);
  assert.doesNotMatch(JSON.stringify(sent), /פריט של משתמש אחר/u);
});

test("updates without text or voice are ignored without touching existing data", async () => {
  const store = fixture();
  const before = JSON.stringify(store);
  const incoming = update();
  delete incoming.message.voice;
  assert.deepEqual(await handleOwnerUpdate(store, {
    sendMessage: async () => assert.fail("unsupported content must not send a reply"),
  }, incoming, {
    ownerChatId: owner,
    transcribeVoice: async () => assert.fail("unsupported content must not transcribe"),
  }), { ignored: true });
  assert.equal(JSON.stringify(store), before);
});
