import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribeTelegramVoice, MAX_VOICE_BYTES } from "../src/voice-transcription.js";
import { TelegramClient } from "../src/telegram.js";
import { reminderValidationTime } from "../src/time.js";

const directory = await mkdtemp(join(tmpdir(), "ah-sheli-voice-"));
process.env.AH_SHELI_DATA_DIR = directory;
const { createEmptyStore } = await import("../src/store.js");
const { handleOwnerUpdate } = await import("../src/message-handler.js");
const { handleAssistantMessage } = await import("../src/assistant.js");
after(() => rm(directory, { recursive: true, force: true }));

const voice = { file_id: "telegram-voice", mime_type: "audio/ogg", duration: 8, file_size: 4 };
const audio = Buffer.from("OggS");
const update = () => ({ update_id: 80, message: {
  message_id: 7, date: 1_800_000_000, voice: { ...voice },
  from: { id: 42 }, chat: { id: 42, type: "private" },
} });
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});

test("Hebrew transcription posts Telegram audio in the documented Groq multipart format", async () => {
  let requests = 0;
  const text = "תזכורת השכמה לשעה 7:30 בבוקר";
  const result = await transcribeTelegramVoice(voice, {
    downloadFile: async (id, options) => {
      assert.equal(id, voice.file_id);
      assert.equal(options.maxBytes, MAX_VOICE_BYTES);
      return { bytes: audio };
    },
  }, { apiKey: "fake-test-key", fetchImpl: async (url, options) => {
    requests++;
    assert.equal(url, "https://api.groq.com/openai/v1/audio/transcriptions");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, "Bearer fake-test-key");
    assert.equal(options.headers["Content-Type"], undefined, "fetch supplies multipart boundary");
    assert.equal(options.body.get("language"), "he");
    assert.equal(options.body.get("model"), "whisper-large-v3-turbo");
    assert.equal(options.body.get("response_format"), "json");
    assert.equal(options.body.get("file").name, "voice.ogg");
    assert.deepEqual(Buffer.from(await options.body.get("file").arrayBuffer()), audio);
    return json({ text: `  ${text}  ` });
  } });
  assert.equal(result, text);
  assert.equal(requests, 1);
});

test("transient provider errors retry once; invalid credentials and unreadable or empty text do not execute commands", async () => {
  let attempts = 0;
  const telegram = { downloadFile: async () => ({ bytes: audio }) };
  assert.equal(await transcribeTelegramVoice(voice, telegram, {
    apiKey: "fake-test-key", fetchImpl: async () => ++attempts === 1
      ? json({}, 503) : json({ text: "מה הלו״ז של היום" }),
  }), "מה הלו״ז של היום");
  assert.equal(attempts, 2);
  for (const [response, code] of [
    [json({ error: "private-provider-error" }, 401), "provider"],
    [new Response("not-json"), "format"],
    [json({ text: " " }), "empty"],
    [json({ text: {} }), "empty"],
  ]) {
    attempts = 0;
    await assert.rejects(transcribeTelegramVoice(voice, telegram, {
      apiKey: "fake-test-key", fetchImpl: async () => { attempts++; return response; },
    }), error => error.code === code && !error.message.includes("private-provider-error"));
    assert.equal(attempts, 1);
  }
});

test("missing configuration and oversized messages stop before downloading or transcribing", async () => {
  const telegram = { downloadFile: async () => assert.fail("must not download") };
  await assert.rejects(transcribeTelegramVoice(voice, telegram, { apiKey: "" }),
    error => error.code === "not_configured");
  await assert.rejects(transcribeTelegramVoice({ ...voice, file_size: MAX_VOICE_BYTES + 1 },
    telegram, { apiKey: "fake-test-key" }), error => error.code === "too_large");
});

test("Telegram getFile downloads only the returned safe path and enforces actual streamed size", async t => {
  let requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/getFile")) return json({
      ok: true, result: { file_path: "voice/file_7.oga", file_size: 4 },
    });
    return new Response(audio);
  });
  const telegram = new TelegramClient("fake-token");
  const result = await telegram.downloadFile(voice.file_id, { maxBytes: 4 });
  assert.deepEqual(result.bytes, audio);
  assert.deepEqual(JSON.parse(requests[0].options.body), { file_id: voice.file_id });
  assert.equal(requests[1].url, "https://api.telegram.org/file/botfake-token/voice/file_7.oga");
  assert.equal(requests[1].options.redirect, "error");
  requests = [];
  await assert.rejects(telegram.downloadFile(voice.file_id, { maxBytes: 3 }),
    error => error.code === "VOICE_TOO_LARGE");
  assert.equal(requests.length, 1, "known oversize is rejected before downloading");
  t.mock.method(globalThis, "fetch", async url => url.endsWith("/getFile")
    ? json({ ok: true, result: { file_path: "voice/file_7.oga" } })
    : new Response(audio));
  await assert.rejects(telegram.downloadFile(voice.file_id, { maxBytes: 3 }),
    error => error.code === "VOICE_TOO_LARGE");
});

test("unsafe Telegram file paths never produce a download request", async t => {
  for (const path of ["../file.ogg", "/voice/file.ogg", "https://foreign.example/audio", "voice//x"]) {
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return json({ ok: true, result: { file_path: path } });
    });
    await assert.rejects(new TelegramClient("fake-token").downloadFile(voice.file_id), /path is invalid/u);
    assert.equal(calls, 1);
  }
});

test("an expired Telegram download path is refreshed with getFile before retrying", async t => {
  let lookups = 0;
  const downloads = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/getFile")) {
      lookups++;
      assert.equal(JSON.parse(options.body).file_id, voice.file_id);
      return json({ ok: true, result: {
        file_path: `voice/file_${lookups}.oga`, file_size: audio.length,
      } });
    }
    downloads.push(url);
    return downloads.length === 1 ? new Response("expired", { status: 404 }) : new Response(audio);
  });
  assert.deepEqual((await new TelegramClient("fake-token").downloadFile(voice.file_id)).bytes, audio);
  assert.equal(lookups, 2);
  assert.ok(downloads[0].endsWith("/voice/file_1.oga"));
  assert.ok(downloads[1].endsWith("/voice/file_2.oga"));
});

test("network, partial-body and interrupted-stream failures retry without accepting incomplete audio", async t => {
  for (const mode of ["network", "partial", "interrupted"]) {
    let lookups = 0, downloads = 0;
    t.mock.method(globalThis, "fetch", async url => {
      if (url.endsWith("/getFile")) {
        lookups++;
        return json({ ok: true, result: { file_path: "voice/file.oga", file_size: audio.length } });
      }
      downloads++;
      if (downloads > 1) return new Response(audio);
      if (mode === "network") throw new Error("private-download-url");
      if (mode === "partial") return new Response(audio.subarray(0, 2));
      return new Response(new ReadableStream({
        start(controller) { controller.error(new Error("private-stream-error")); },
      }));
    });
    assert.deepEqual((await new TelegramClient("fake-token").downloadFile(voice.file_id)).bytes, audio);
    assert.equal(lookups, 2);
    assert.equal(downloads, 2);
  }
});

test("download exhaustion reports only safe diagnostics and never sends partial audio to Groq", async t => {
  let lookups = 0, downloads = 0, transcriptionCalls = 0;
  t.mock.method(globalThis, "fetch", async url => {
    if (url.endsWith("/getFile")) {
      lookups++;
      return json({ ok: true, result: { file_path: "voice/file.oga", file_size: audio.length } });
    }
    if (url.includes("/file/bot")) {
      downloads++;
      return new Response("private Telegram body must not leak", { status: 503 });
    }
    transcriptionCalls++;
    assert.fail("cannot transcribe an unsuccessful download");
  });
  await assert.rejects(transcribeTelegramVoice(voice, new TelegramClient("fake-token"), {
    apiKey: "fake-test-key",
  }), error => error.code === "download" && error.stage === "VOICE_DOWNLOAD_HTTP"
    && error.status === 503 && !error.message.includes("private"));
  assert.equal(lookups, 2);
  assert.equal(downloads, 2);
  assert.equal(transcriptionCalls, 0);
});

test("invalid getFile IDs are terminal; read-only server failures retry once", async t => {
  for (const status of [400, 503]) {
    let lookups = 0;
    t.mock.method(globalThis, "fetch", async () => {
      lookups++;
      return json({ ok: false, error_code: status, description: "private-provider-description" }, status);
    });
    await assert.rejects(new TelegramClient("fake-token").downloadFile(voice.file_id),
      error => error.code === "VOICE_GET_FILE" && error.status === status
        && !error.message.includes("private-provider-description"));
    assert.equal(lookups, status === 400 ? 1 : 2);
  }
});

test("the complete Telegram File API -> audio upload -> transcript -> saved action -> reply chain runs once", async t => {
  const transcript = "תוסיף חלב וביצים לרשימת הקניות";
  let lookups = 0, downloads = 0, transcriptions = 0;
  const replies = [], turns = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/getFile")) {
      lookups++;
      return json({ ok: true, result: { file_path: "voice/file.oga", file_size: audio.length } });
    }
    if (url.includes("/file/bot")) {
      downloads++;
      return downloads === 1 ? new Response(audio.subarray(0, 2)) : new Response(audio);
    }
    if (url === "https://api.groq.com/openai/v1/audio/transcriptions") {
      transcriptions++;
      assert.deepEqual(Buffer.from(await options.body.get("file").arrayBuffer()), audio);
      return json({ text: transcript });
    }
    assert.ok(url.endsWith("/sendMessage"));
    replies.push(JSON.parse(options.body));
    return json({ ok: true, result: { message_id: 999 } });
  });
  const store = createEmptyStore();
  store.lists["42"] = { קניות: [] };
  await handleOwnerUpdate(store, new TelegramClient("fake-token"), update(), {
    ownerChatId: "42",
    transcribeVoice: (recording, client, options) => transcribeTelegramVoice(recording, client, {
      ...options, apiKey: "fake-test-key",
    }),
    replyOptions: {
      readHistory: async () => [],
      saveConversation: async (...args) => turns.push(args),
      assistant: (state, owner, text, unused, history) => {
        assert.equal(text, transcript);
        return handleAssistantMessage(state, owner, text, async () => ({
          type: "add-items", listName: "קניות", items: ["חלב", "ביצים"],
        }), history);
      },
    },
  });
  assert.equal(lookups, 2);
  assert.equal(downloads, 2);
  assert.equal(transcriptions, 1);
  assert.deepEqual(store.lists["42"].קניות.map(item => item.text), ["חלב", "ביצים"]);
  assert.equal(turns.length, 1);
  assert.equal(turns[0][1], transcript);
  assert.equal(replies.length, 1);
  assert.ok(replies[0].text.endsWith(turns[0][2]));
  assert.match(replies[0].text, /🛒 קניות/u);
});

test("voice uses the ordinary conversation pipeline and preserves the original request clock and update", async () => {
  const incoming = update();
  const original = JSON.stringify(incoming);
  const store = createEmptyStore();
  const sent = [], saved = [];
  const transcript = "תזכורת השכמה לשעה 7:30 בבוקר";
  let assistantCalls = 0;
  await handleOwnerUpdate(store, { sendMessage: async (...args) => sent.push(args) }, incoming, {
    ownerChatId: "42",
    transcribeVoice: async () => transcript,
    replyOptions: {
      readHistory: async () => [{ role: "user", content: "שיחה קודמת" }],
      saveConversation: async (...args) => saved.push(args),
      assistant: async (state, owner, text, unused, history) => {
        assistantCalls++;
        assert.equal(state, store);
        assert.equal(owner, "42");
        assert.equal(text, transcript);
        assert.equal(reminderValidationTime(), incoming.message.date * 1000);
        assert.equal(history[0].content, "שיחה קודמת");
        return "קיבלתי, אעשה השכמה לשעה 7:30 בבוקר.";
      },
    },
  });
  assert.equal(assistantCalls, 1);
  assert.deepEqual(saved, [["42", transcript, sent[0][1]]]);
  assert.equal(sent.length, 1);
  assert.equal(JSON.stringify(incoming), original);
});

test("spoken and written list requests perform the same real saved action with the same human reply", async () => {
  const transcript = "תוסיף חלב וביצים לרשימת הקניות";
  const results = [];
  for (const spoken of [true, false]) {
    const store = createEmptyStore();
    store.lists["42"] = { קניות: [] };
    const incoming = update();
    if (!spoken) { delete incoming.message.voice; incoming.message.text = transcript; }
    const sent = [], saved = [];
    await handleOwnerUpdate(store, { sendMessage: async (...args) => sent.push(args) }, incoming, {
      ownerChatId: "42",
      transcribeVoice: async () => transcript,
      replyOptions: {
        readHistory: async () => [],
        saveConversation: async (...args) => saved.push(args),
        assistant: (state, owner, text, unused, history) => handleAssistantMessage(
          state, owner, text, async () => ({
            type: "add-items", listName: "קניות", items: ["חלב", "ביצים"],
          }), history),
      },
    });
    const { menuRecords } = await import("../src/record-menu.js");
    const keys = menuRecords(store, "42", "s").map(record => record.key);
    for (const [, , options] of sent) for (const row of options?.reply_markup?.inline_keyboard ?? []) {
      for (const button of row) if (button.callback_data?.startsWith("v:i:")) {
        assert.ok(keys.some(key => button.callback_data.startsWith(`v:i:${key}:`)));
      }
    }
    // Two independent creations correctly get different stable IDs. Compare
    // visible UI equivalence, while validating each real callback above.
    const visibleMessages = structuredClone(sent);
    for (const [, , options] of visibleMessages) for (const row of options?.reply_markup?.inline_keyboard ?? []) {
      for (const button of row) delete button.callback_data;
    }
    results.push({ items: store.lists["42"].קניות.map(item => item.text), sent: visibleMessages, saved });
  }
  assert.deepEqual(results[0].items, ["חלב", "ביצים"]);
  assert.deepEqual(results[0], results[1]);
});

test("unauthorized voice is never downloaded; failed transcription sends a warm reply without history or actions", async () => {
  const incoming = update();
  for (const change of [
    message => { message.from.id = 99; },
    message => { message.chat.id = 99; },
    message => { message.chat.type = "group"; },
    message => { message.from.is_bot = true; },
  ]) {
    const foreign = structuredClone(incoming);
    change(foreign.message);
    assert.deepEqual(await handleOwnerUpdate(createEmptyStore(), {
      sendMessage: async () => assert.fail("must not reply through owner pipeline"),
    }, foreign, {
      ownerChatId: "42", transcribeVoice: async () => assert.fail("must not transcribe"),
    }), { ignored: true });
  }
  const store = createEmptyStore();
  const before = JSON.stringify(store);
  const sent = [];
  assert.deepEqual(await handleOwnerUpdate(store, {
    sendMessage: async (owner, text) => sent.push(text),
  }, incoming, {
    ownerChatId: "42",
    transcribeVoice: async () => { throw new Error("private API error must never be sent"); },
    replyOptions: {
      readHistory: async () => assert.fail("must not read history"),
      saveConversation: async () => assert.fail("must not save a false turn"),
      assistant: async () => assert.fail("must not perform actions"),
    },
  }), { transcriptionFailed: true });
  assert.match(sent[0], /אפשר לשלוח שוב או לכתוב לי/u);
  assert.doesNotMatch(sent[0], /API|private/u);
  assert.equal(JSON.stringify(store), before);
});

test("loss of worker ownership during transcription prevents all replies and saved actions", async () => {
  let active = true;
  await assert.rejects(handleOwnerUpdate(createEmptyStore(), {
    sendMessage: async () => assert.fail("must not send"),
  }, update(), {
    ownerChatId: "42",
    assertActive: () => { if (!active) throw new Error("inactive"); },
    transcribeVoice: async () => { active = false; return "תוסיף חלב לקניות"; },
  }), /inactive/u);
});
