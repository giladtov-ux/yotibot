// Render runs the complete service from the repository root with node index.js.
// The API supervises one existing worker; never start another worker here.
async function startSystem({
  version = process.versions.node,
  env = process.env,
  validateEnvironment = async config => {
    const { cloudEnvironmentErrors } = await import('./scripts/cloud-start.mjs');
    return cloudEnvironmentErrors(config);
  },
  loadServer = () => import('./artifacts/api-server/dist/index.mjs'),
} = {}) {
  const [major, minor] = version.split('.').map(Number);
  if (!Number.isInteger(major) || !Number.isInteger(minor)
      || major < 22 || (major === 22 && minor < 18)) {
    throw new Error('Node.js 22.18 or later is required.');
  }
  if (env.NODE_ENV === 'production' && env.CLOUD_CUTOVER_APPROVED !== '1') {
    throw new Error('Stop the previous worker and approve the production cutover first.');
  }
  const errors = await validateEnvironment(env);
  if (errors.length) throw new Error(errors.join('\n'));
  return await loadServer();
}

module.exports = { startSystem };


