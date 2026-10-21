import { setTimeout as sleep } from "node:timers/promises";
import { conversationalPayload } from "./telegram-presentation.js";

function voiceFileError(code, status, retryable = false) {
  return Object.assign(new Error("Telegram voice file transfer failed."), { code, status, retryable });
}

export class TelegramClient {
  constructor(token, { signal, assertActive = () => {} } = {}) {
    this.baseUrl = `https://api.telegram.org/bot${token}/`;
    this.fileBaseUrl = `https://api.telegram.org/file/bot${token}/`;
    this.signal = signal;
    this.assertActive = assertActive;
  }

  async call(method, payload = {}, options = {}) {
    payload = conversationalPayload(method, payload);
    let response;
    const callerSignal = options.signal ?? this.signal;
    const signal = callerSignal
      ? AbortSignal.any([
          callerSignal,
          AbortSignal.timeout(options.timeoutMs ?? 20_000),
        ])
      : AbortSignal.timeout(options.timeoutMs ?? 20_000);
    try {
      response = await fetch(`${this.baseUrl}${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new Error(`Network request to Telegram failed: ${error.message}`);
    }

    let result;
    try {
      result = await response.json();
    } catch {
      throw new Error(`Telegram returned an unreadable response (${response.status}).`);
    }

    if (!response.ok || !result?.ok) {
      const description =
        typeof result?.description === "string"
          ? result.description
          : `HTTP ${response.status}`;
      const retryAfter = result?.parameters?.retry_after;
      const error = new Error(
        `Telegram ${method} failed: ${description}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`,
      );
      // An explicit Bot API rejection confirms the message was not accepted.
      // A network timeout or unreadable response is not proof of non-delivery.
      error.deliveryRejected = result?.ok === false;
      if (method === "getFile") {
        error.status = Number.isInteger(result?.error_code) ? result.error_code : response.status;
        error.retryAfter = Number.isFinite(retryAfter) ? retryAfter : undefined;
      }
      throw error;
    }
    return result.result;
  }

  async downloadFile(fileId, { maxBytes = 20_000_000, signal } = {}) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.downloadVoiceFileOnce(fileId, maxBytes, signal);
      } catch (error) {
        this.assertActive();
        if (this.signal?.aborted || signal?.aborted || !error.retryable || attempt === 2) throw error;
        await sleep(error.retryDelayMs ?? 250, undefined, {
          signal: this.signal && signal ? AbortSignal.any([this.signal, signal]) : signal ?? this.signal,
        });
      }
    }
  }

  async downloadVoiceFileOnce(fileId, maxBytes, deadlineSignal) {
    this.assertActive();
    // Obtain a fresh Telegram path on every attempt; an expired download link
    // must not be reused. These are read-only retries, never action replays.
    let file;
    try {
      file = await this.call("getFile", { file_id: fileId }, {
        timeoutMs: 8_000,
        signal: this.signal && deadlineSignal
          ? AbortSignal.any([this.signal, deadlineSignal]) : deadlineSignal ?? this.signal,
      });
    } catch (error) {
      const retryable = !error.deliveryRejected || error.status >= 500
        || (error.status === 429 && (error.retryAfter ?? 0) <= 5);
      const safeError = voiceFileError("VOICE_GET_FILE", error.status, retryable);
      safeError.retryDelayMs = Math.max(250, (error.retryAfter ?? 0) * 1000);
      throw safeError;
    }
    const tooLarge = () => Object.assign(new Error("Voice file exceeds size limit."), {
      code: "VOICE_TOO_LARGE",
    });
    if (file?.file_size > maxBytes) throw tooLarge();
    // File paths come from Telegram, never from user text or a remote URL.
    const path = file?.file_path;
    if (typeof path !== "string" || !/^[a-zA-Z0-9_./-]+$/u.test(path)
      || path.startsWith("/") || path.split("/").some(part => part === ".." || !part)) {
      throw new Error("Telegram voice file path is invalid.");
    }
    this.assertActive();
    const signal = AbortSignal.any([
      ...[this.signal, deadlineSignal].filter(Boolean),
      AbortSignal.timeout(file.file_size > 1_000_000 ? 30_000 : 7_000),
    ]);
    let response;
    try {
      response = await fetch(`${this.fileBaseUrl}${path}`, { signal, redirect: "error" });
    } catch {
      // Fetch errors can contain a URL with the bot token; do not retain it.
      throw voiceFileError("VOICE_DOWNLOAD_NETWORK", undefined, true);
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel().catch(() => {});
      throw voiceFileError("VOICE_DOWNLOAD_HTTP", response.status,
        response.status === 404 || response.status === 206 || response.status >= 500);
    }
    if (Number(response.headers.get("content-length")) > maxBytes) {
      await response.body.cancel();
      throw tooLarge();
    }
    const reader = response.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        this.assertActive();
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > maxBytes) throw tooLarge();
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error?.code === "VOICE_TOO_LARGE") throw error;
      throw voiceFileError("VOICE_DOWNLOAD_INTERRUPTED", undefined, true);
    } finally {
      reader.releaseLock();
    }
    this.assertActive();
    const expectedSize = file.file_size;
    const headerSize = Number(response.headers.get("content-length"));
    if ((Number.isSafeInteger(expectedSize) && expectedSize > 0 && length !== expectedSize)
      || (Number.isSafeInteger(headerSize) && headerSize > 0 && length !== headerSize)) {
      throw voiceFileError("VOICE_DOWNLOAD_INCOMPLETE", undefined, true);
    }
    return { bytes: Buffer.concat(chunks, length) };
  }

  async sendMessage(chatId, text, options = {}) {
    let remaining = text;
    let result;
    let acceptedChunks = 0;
    do {
      this.assertActive();
      let end = Math.min(remaining.length, 4_000);
      if (end < remaining.length) {
        const newline = remaining.lastIndexOf("\n", end - 1);
        if (newline > 0) end = newline + 1;
        else if (/[\uD800-\uDBFF]/u.test(remaining[end - 1])) end -= 1;
      }
      try {
        result = await this.call("sendMessage", {
          chat_id: chatId,
          text: remaining.slice(0, end),
          disable_web_page_preview: true,
          ...(options.reply_parameters ? { reply_parameters: options.reply_parameters } : {}),
          ...(options.parse_mode ? { parse_mode: options.parse_mode } : {}),
          ...(end === remaining.length && options.reply_markup
            ? { reply_markup: options.reply_markup } : {}),
        });
        acceptedChunks++;
      } catch (error) {
        // Replaying the whole message would duplicate previously accepted parts.
        if (acceptedChunks > 0) error.deliveryRejected = false;
        throw error;
      }
      remaining = remaining.slice(end);
    } while (remaining.length);
    return result;
  }
}
