import { timingSafeEqual } from "node:crypto";

export function matchesSecret(supplied, expected) {
  if (typeof supplied !== "string" || !expected) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
