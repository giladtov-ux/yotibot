// Use Israel's IANA rules, including DST, even when the host defaults to UTC.
// Changing the local timezone does not change UTC epoch timestamps.
export const TIME_ZONE = "Asia/Jerusalem";
process.env.TZ = TIME_ZONE;
