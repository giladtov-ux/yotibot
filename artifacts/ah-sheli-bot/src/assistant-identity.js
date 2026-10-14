// Runtime supplies the verified private-chat identity. Legacy isolated callers
// retain their owner-only context; provider calls without context default generic.
export function assistantIdentity(store, chatId) {
  return store.assistantIdentity?.(chatId) ?? { isOwner: true };
}
