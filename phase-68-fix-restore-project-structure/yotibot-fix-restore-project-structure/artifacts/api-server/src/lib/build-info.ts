export const buildInfo = Object.freeze({
  id: process.env.AH_SHELI_BUILD_ID ?? "unavailable",
  commit: process.env.AH_SHELI_COMMIT_SHA ?? "unavailable",
  releaseTag: process.env.AH_SHELI_RELEASE_TAG || null,
  dirty: process.env.AH_SHELI_BUILD_DIRTY === "true",
});
