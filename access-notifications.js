// Telegram has no sendMessage idempotency key. Persist BEFORE sending and
// never replay failed/unknown attempts, including after a process restart.
export async function sendAccessNotification({
  repository, telegram, eventKey, userId, recipientId, text, assertActive,
}) {
  try {
    assertActive();
    if (!await repository.claimNotification(eventKey, userId, recipientId)) return "skipped";
  } catch {
    console.warn("[Ah Sheli] Access notification not sent: attempt could not be recorded.");
    return "unknown";
  }
  let status;
  try {
    assertActive();
    await telegram.sendMessage(recipientId, text);
    status = "sent";
  } catch (error) {
    status = error?.deliveryRejected === true ? "failed" : "unknown";
  }
  try {
    await repository.finishNotification(eventKey, status);
  } catch {
    console.warn("[Ah Sheli] Access notification receipt not confirmed; attempt remains blocked.");
    return "unknown";
  }
  if (status !== "sent") console.warn(`[Ah Sheli] Access notification delivery: ${status}; no automatic replay.`);
  return status;
}
