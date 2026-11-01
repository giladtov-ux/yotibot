---
name: Voice input verification
description: Preserve ordinary message behavior and distinguish speech-service connectivity from transcription accuracy.
---

Voice input is an adapter to the existing conversation and saved-action behavior,
not a second action engine or a reason to switch the chat AI provider.
Ordinary written messages must remain usable independently of speech support.
Adding or repairing voice must never reset existing users' data.

**Why:** the user requested that voice act exactly like typed text while leaving
all other menus, clock and logic unchanged, and repeated that text and existing
data must not be affected by the voice feature. An existing speech-service credential
allowed adding transcription without changing the chat provider.

**How to apply:** preserve owner authorization, original Telegram request time,
conversation context and update deduplication. Transcribe before any saved actions;
never treat failed transcription as a guessed command.

An STT failure must receive a short warm, recording-specific local clarification,
not a second model call with an empty request. This is an explicit exception to
model-authored ordinary conversation, not a replacement for successful voice input.

**Why:** the user requested removal of generic robotic clarification loops;
asking the chat provider to explain a failed transcription adds another failure
dependency and can revive unrelated conversation context.

**How to apply:** recheck authorization and worker ownership before the notice,
do not save a fabricated turn, infer actions or claim hearing. Keep successful
transcripts on the same ordinary tool pipeline and do not reject usable speech
solely because the recording is short.

A completed Telegram download followed by an STT transport failure without an
HTTP status does not prove that Ogg/Opus or the multipart contract is unsupported.
Do not change codecs or providers based on that symptom alone.

**Why:** production voice failures occurred after successful audio retrieval but
before an HTTP response; the generic network category concealed the cause.

**How to apply:** preserve safe transport categories from nested exceptions,
distinguish request transport from response-body reading, and verify multipart
serialization independently of acoustic recognition. A localhost wire-format
test proves byte preservation, not provider availability or speech accuracy.
The same no-response symptom in chat and STT still does not establish whether
the cause is networking or local credential/header construction. Do not reset
keys, change a documented supported payload, or claim a provider rejected a
request without a specific configuration marker or an HTTP response.

A silent synthetic clip can check service connectivity, but not speech accuracy.
Speech-model confidence alone does not prove someone actually spoke.

**Why:** the live speech service returned short text for a generated silent clip,
even reporting zero no-speech probability.

**How to apply:** distinguish endpoint/authentication checks from real spoken
Hebrew validation. Do not claim that a successful silent-audio probe establishes
accurate extraction of reminder text, dates or times.

A real recording must also be checked against a known complete transcript,
not just a correctly recognized opening sentence.

**Why:** two live speech models agreed on the opening question of an uploaded
Hebrew recording but returned different wording for the rest.

**How to apply:** report recognition uncertainty honestly. Do not claim perfect
transcription based on a successful API response or fill unclear speech with
facts inferred from a reference screenshot.

Diagnose Telegram audio retrieval separately from the speech provider. The voice
path uses AssemblyAI directly with `ASSEMBLYAI_API_KEY`, the `universal-2` model,
and explicit Hebrew (`language_code: he`). Upload the original OGG/OGA/Opus bytes
without transcoding, submit them through the transcript API, and poll only within
the existing bounded request deadline. Keep the chat provider unchanged.

**Why:** the user explicitly replaced the previous transcription provider with
AssemblyAI while preserving the established text/chat path; AssemblyAI documents
native OGG/OGA/Opus support and Hebrew support for Universal-2.

**How to apply:** inspect safe stage/status diagnostics first. Never use Groq,
OpenRouter Whisper, or direct OpenAI as transcription fallback. Keep the complete
transcript on the existing authorized action pipeline, and ask a short natural
clarification if no usable transcript is obtained.

Repeated requests to rephrase a voice message do not establish transcription
failure. Check whether speech succeeded and the conversation engine subsequently
treated the transcript as an unsupported request or repeated an old clarification.
Capability questions are read-only conversation, not a missing detail in a draft.

Voice must now use OpenRouter exclusively with the existing environment key;
do not restore direct Groq/OpenAI fallbacks without separate user permission.

Gateway choice alone does not exclude Groq as an upstream behind OpenRouter.
STT routing ignore/only preferences are not enforced by the documented endpoint.

**Why:** the user requested full Groq disconnection, including voice. A model's
creator prefix does not establish which company serves its transcription requests.

**How to apply:** inspect the public model endpoint catalog when choosing speech
models, distinguish gateway from upstream provider, and disclose catalog changes
as a remaining dependency rather than claiming a future routing guarantee.

AssemblyAI audio upload and transcription are separate remote steps; a successful
mocked pipeline verifies request shape and byte preservation, not live account
authorization or Hebrew recognition accuracy.

**Why:** AssemblyAI requires an upload URL before a transcript job can be created,
and real speech accuracy cannot be inferred from test fixtures.

**How to apply:** validate the staged REST flow locally with synthetic audio and
responses, then verify real Hebrew accuracy only with an authorized spoken sample.
Never expose the API key, audio, or transcript in diagnostics.

**Why:** the user reported a broken voice loop, but the corresponding production
logs showed successful transcriptions; ordinary text capability questions fell
into the same irrelevant clarification loop.

**How to apply:** verify the complete audio-to-saved-action path, not just a
successful speech response. Keep capability answers separate from pending
mutations, and never claim accurate hearing of a recording solely from API success.
