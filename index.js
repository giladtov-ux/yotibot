// Root entry point for Render: keep Root Directory empty and run node index.js.
// The existing worker retains ownership, SQL persistence and webhook handling.
async function startBot({
  version = process.versions.node,
  env = process.env,
  loadBot = () => import('./artifacts/ah-sheli-bot/index.js'),
} = {}) {
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)
      || major < 22 || (major === 22 && minor < 18)) {
    throw new Error('Node.js 22.18 or later is required.');
  }
  if (env.NODE_ENV === 'production' && env.CLOUD_CUTOVER_APPROVED !== '1') {
    throw new Error('Stop the previous worker and approve the production cutover first.');
  }
  return await loadBot();
}

module.exports = { startBot };

if (require.main === module) {
  startBot().catch(() => {
    // Import errors can contain credentials; do not print their raw contents.
    console.error('[Ah Sheli] Startup failed. Verify Node.js >=22.18, production cutover approval, dependencies and bot/database settings. No secrets were logged.');
    process.exitCode = 1;
  });
}
