export type EnvironmentMap = Record<string, string | undefined>;

export function validateLocalLabDatabaseUrl(value: string): string;
export function databaseUrlForProcess(env?: EnvironmentMap): string;
export function createGuardedPool(
  env: EnvironmentMap,
  createPool: (options: Record<string, unknown>) => unknown,
  options: Record<string, unknown>,
): unknown;
export function createLabTestEnvironment(sourceEnv?: EnvironmentMap): EnvironmentMap;
