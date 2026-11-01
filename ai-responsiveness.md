---
name: AI responsiveness
description: Preserve complete schedules while reducing transmitted context and bounding provider latency.
---
## Provider capacity and retry deadlines

Use one end-to-end time budget for both transport retries and interpretation repairs. A repair must not silently start a fresh full timeout.

**Why:** independent retry budgets can multiply a user's wait. Also, a successful individual AI reply does not establish sustained availability: a large system prompt can consume most of a provider's per-minute token allowance even when the reply is short.

**How to apply:** preserve complete user requests, saved schedules and clarification context. Check input-token consumption and live rate-limit metadata before attributing every failure to networking or extending timeouts. Do not silently change providers or remove necessary context to hide quota failures.

Use OpenRouter exclusively for conversation and transcription. Do not restore
direct Groq/OpenAI access, automatic Groq fallback, or selection based on whichever
credential happens to exist. Preserve complete owner-filtered context and input.

**Why:** the user explicitly superseded the earlier Groq-primary decision and
requested full disconnection from Groq after voice/network and quota failures.
This choice does not prove that the existing OpenRouter transport issue is fixed.

**How to apply:** keep action validation and database confirmation unchanged,
observe provider cooldowns, and do not retry malformed action output on another
provider merely to obtain a success claim. Report provider changes to the creator,
not as unsolicited technical notices inside the user's bot conversation.

An OpenRouter 404 does not by itself prove the model name is invalid. Strict
parameter routing can exclude every endpoint of an otherwise active model,
including when an unsupported optional parameter is explicitly set to false.

**Why:** a controlled synthetic comparison for the existing GPT-4o-mini model
returned 404 with the parallel-tool parameter and 200 without it. Changing
models or credentials would not address that request compatibility failure.

**How to apply:** distinguish missing-model errors from endpoint-selection
errors, consult the current endpoint parameter catalog, and preserve application
write fencing and sequential tool execution when adapting provider payloads.

Use the user's chosen lightweight model with a small normal output budget and larger bounded budgets only when a whole batch requires them.

**Why:** the user reported very slow replies and requested less output and less history without losing complete schedules.

**How to apply:** reduce transmitted context rather than deleting saved conversation data or truncating the current message. Preserve the original schedule through clarification turns. Keep retry time bounded across all attempts, and use stage timings to separate provider latency from database or Telegram delays; an AI timeout does not bound the whole delivery pipeline.

For voice latency, measure queue wait and audio acquisition separately from
speech recognition and the final Telegram delivery. Do not switch the speech
model merely because the complete voice response is slow.

**Why:** live logs showed quarter-second transcription despite much longer
end-to-end waits; changing the speech model would not address those delays.

**How to apply:** use one download/transcription deadline across retries, allow
more time for genuinely long recordings, and never shorten audio or the complete
saved-data response to claim a faster reply. Bare list names can still answer a
pending destination question; skip history only for unmistakable retrievals.

Verify real structured generation with the current credential before claiming the AI is working.

**Why:** the project has encountered both advertised models that did not generate successfully and a saved API credential rejected by its provider. Secret existence and mocked tests are not proof of access.

**How to apply:** use synthetic schedule text for live parsing checks without changing personal data. Sanitize errors, never show rejected credentials, and request a replacement through Secrets if authentication fails. No provider or billing fallback.

In reminder capability probes, distinguish one reminder plus its matching task
from duplicate reminders, and report title, delay, schema and mutation-count
checks separately.

**Why:** an aggregate “one change” assertion rejected a legitimate paired action,
and a later aggregate check obscured an exact-title mismatch despite a correct
two-minute delay. Neither mismatch alone proves that the provider or writer is
broken.

**How to apply:** retain sanitized per-field verdicts in the first probe, keep
actual writes disabled, and do not equate an HTTP success or valid tool schema
with verified reminder content or persistence.

Keep forced tool-choice capability tests separate from automatic conversational
tool selection, and stop a repeated live probe at the first rate-limit response.

**Why:** named-tool probes produced the exact synthetic reminder title and delay,
but a subsequent sample hit a rate limit before the automatic-selection comparison.
Forcing a tool proves neither autonomous intent selection nor sustained capacity.

**How to apply:** label the tested selection mode explicitly, never force writes
for ordinary chat, and do not advertise 100% reliability from a finite sample.

On rate limiting, prefer prompt failure plus a header-informed local cooldown
over sleeping and retrying inside Telegram's webhook request.
One generation-only retry is allowed for a provider-directed wait of at most
1.5 seconds within the existing deadline. Longer or unknown resets retain the
cooldown; they are not an invitation to replay updates or queue writes silently.

**Why:** the user approved avoiding prolonged webhook waits and excess attempts.
A live synthetic reminder and ordinary chat succeeded, but exhausted minute-level
token capacity before the missing-time case; connectivity was not the blocker.

**How to apply:** distinguish request counts from token capacity, honor provider
reset guidance, and retain before/after-write outcomes. A per-process cooldown
is not a durable queue or an organization-wide rate limiter.

Verified tool mutation receipts can supply a local acknowledgement when final
model generation is rate-limited, unavailable or returns internal/invalid prose.
Never infer success from a proposed action, an ambiguous commit, or model text.
Reject echoed request envelopes and JSON at the model-prose boundary.

**Why:** a second model call failing after a successful write must not hide a
saved reminder or encourage duplicate creation; internal context is not a reply.

**How to apply:** preserve permission/activity fences and send the saved-value
confirmation and current gallery without executing the mutation again. Before
any write, a long capacity limit remains a clearly disclosed unsaved request,
not a successful reminder or an unimplemented promise of automatic recovery.

Keep basic conversational memory within the existing durable, owner-scoped history rather than adding a separate memory store. Transmit a bounded chronological conversation only once, with clear speaker roles and permanent system instructions.

**Why:** the user requested basic conversation memory and a fixed personal-assistant identity without changing or breaking the existing structure; prior slow responses make duplicated or unbounded context unsuitable.

**How to apply:** retain stored turns across restarts, use recent history for follow-ups, and do not replay old actions or treat historical content as system instructions. Preserve the original roster when clarifying and the existing fast path for a complete new roster.

Match structured-output mode to the chosen model, not merely its API-compatible endpoint.

**Why:** Groq's Llama Instant supports JSON Object Mode, not the strict JSON Schema settings from the earlier OpenAI client. A valid Groq key can also list a different model catalog from public documentation.

**How to apply:** retain application validation before any writes, reject truncated/refused output, and verify live generation as well as the authenticated catalog. If the requested model is absent, offer a verified alternative rather than treating it as an invalid key or silently switching.

Accept completed natural conversation replies without requiring action-shaped JSON, but never treat a model's prose confirmation as proof that data was saved.

**Why:** the user reported ordinary warm replies causing JSON-format errors and local-mode messages, including list additions.

**How to apply:** tolerate complete fenced/embedded JSON and minimal conversation objects while validating actions strictly. Recover unmistakable list requests from the current user's text and confirm only after persistence. Reject malformed/truncated action JSON, ambiguous actions, and unsupported save claims. If Groq rejects JSON mode itself, make at most one format-recovery retry within the existing total time/attempt budget; never use failed_generation as a completed answer.

List follow-ups refer to the last successfully edited list, not the most recently displayed one.

**Why:** displaying a list is retrieval, not the user's decision to change the destination for additions. AI promises and historical dialogue are not evidence that an edit succeeded.

**How to apply:** preserve that meaning when extending conversational follow-ups. Prefer a focused clarification over interpreting mixed requests or unfamiliar destination wording as literal list items.

When an addition is awaiting its destination, a bare reply must identify an existing list in that chat; unfamiliar text is not permission to invent a new list.

**Why:** an unknown destination name and an unrelated conversational reply cannot be reliably distinguished without another explicit instruction. The original items must remain available without letting AI confirmations authorize a write.

**How to apply:** keep clarification resolution code-owned and owner-scoped. Require an explicit new request or an additional confirmation flow for new destinations, and close the pending request in the same durable write as the completed addition to prevent restart replay.
