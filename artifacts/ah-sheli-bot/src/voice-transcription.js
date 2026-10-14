import { setTimeout as sleep } from "node:timers/promises";

export const MAX_VOICE_BYTES = 20_000_000;
const TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export class VoiceTranscriptionError extends Error {
  constructor(code, status) {
    super(`Voice transcription unavailable: ${code}`);
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
  }
}

// Audio exists in memory only. Chat AI configuration and saved-action parsing
// are deliberately not involved in transcription.
export async function transcribeTelegramVoice(voice, telegram, {
  apiKey = process.env.GROQ_API_KEY,
  fetchImpl = fetch,
  assertActive = () => {},
} = {}) {
  if (!apiKey?.trim()) throw new VoiceTranscriptionError("not_configured");
  if (typeof voice?.file_id !== "string" || !voice.file_id) {
    throw new VoiceTranscriptionError("invalid_voice");
  }
  if (voice.file_size > MAX_VOICE_BYTES) throw new VoiceTranscriptionError("too_large");
  const started = performance.now();
  // One deadline shared across download and speech retries, never per attempt.
  // Long recordings retain a larger budget; no bytes or spoken words are cut.
  const longRecording = voice.duration > 30 || voice.file_size > 1_000_000;
  const deadline = AbortSignal.timeout(longRecording ? 60_000 : 12_000);
  const requestSignal = telegram.signal ? AbortSignal.any([telegram.signal, deadline]) : deadline;
  assertActive();
  let bytes;
  try {
    ({ bytes } = await telegram.downloadFile(voice.file_id, {
      maxBytes: MAX_VOICE_BYTES, signal: requestSignal,
    }));
  } catch (error) {
    const failure = new VoiceTranscriptionError(
      error?.code === "VOICE_TOO_LARGE" ? "too_large" : "download", error?.status);
    if (/^VOICE_(?:GET_FILE|DOWNLOAD_[A-Z_]+|TOO_LARGE)$/u.test(error?.code ?? "")) {
      failure.stage = error.code;
    }
    throw failure;
  }
  if (!bytes?.byteLength) throw new VoiceTranscriptionError("empty");
  if (bytes.byteLength > MAX_VOICE_BYTES) throw new VoiceTranscriptionError("too_large");
  const downloadMs = Math.round(performance.now() - started);
  console.info("[Ah Sheli] Voice audio downloaded", { bytes: bytes.byteLength, downloadMs });
  for (let attempt = 0; attempt < 2; attempt++) {
    assertActive();
    if (requestSignal.aborted) throw new VoiceTranscriptionError("cancelled");
    const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(longRecording ? 30_000 : 6_000)]);
    const form = new FormData();
    const format = {
      "audio/mpeg": ["audio/mpeg", "mp3"],
      "audio/mp4": ["audio/mp4", "m4a"],
      "audio/x-m4a": ["audio/mp4", "m4a"],
    }[voice.mime_type] ?? ["audio/ogg", "ogg"];
    form.append("file", new Blob([bytes], { type: format[0] }), `voice.${format[1]}`);
    form.append("model", "whisper-large-v3-turbo");
    form.append("language", "he");
    form.append("response_format", "json");
    form.append("temperature", "0");
    let response;
    try {
      response = await fetchImpl(TRANSCRIPTION_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
        body: form,
        signal,
      });
    } catch {
      if (attempt === 0 && !requestSignal.aborted) {
        await sleep(250, undefined, { signal: requestSignal });
        continue;
      }
      throw new VoiceTranscriptionError("network");
    }
    if (!response.ok) {
      if (attempt === 0 && !requestSignal.aborted && (response.status === 429 || response.status >= 500)) {
        await sleep(250, undefined, { signal: requestSignal });
        continue;
      }
      throw new VoiceTranscriptionError("provider", response.status);
    }
    let result;
    try { result = await response.json(); }
    catch { throw new VoiceTranscriptionError("format"); }
    if (typeof result?.text !== "string" || !result.text.trim()) {
      throw new VoiceTranscriptionError("empty");
    }
    assertActive();
    console.info("[Ah Sheli] Voice transcribed", {
      characters: result.text.trim().length, downloadMs,
      transcriptionMs: Math.round(performance.now() - started) - downloadMs,
      totalMs: Math.round(performance.now() - started), attempts: attempt + 1,
    });
    return result.text.trim();
  }
}

export function voiceFailureReply(error) {
  if (error?.code === "too_large") {
    return "ההודעה הקולית גדולה מדי. שלח אותה בכמה חלקים ואטפל בכולה.";
  }
  if (error?.code === "empty") {
    return "לא הצלחתי לשמוע מילים ברורות בהקלטה. אפשר לשלוח אותה שוב?";
  }
  if (error?.code === "not_configured") {
    return "התמלול עדיין לא מחובר. בינתיים אפשר לשלוח לי את ההודעה בטקסט.";
  }
  return "לא הצלחתי לתמלל את ההודעה הקולית כרגע. אפשר לשלוח שוב או לכתוב לי?";
}
