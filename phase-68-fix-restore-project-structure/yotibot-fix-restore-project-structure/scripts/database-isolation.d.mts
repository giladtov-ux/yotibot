export type EnvironmentMap = Record<string, string | undefined>;

export function assertNotKnownProductionTarget(value: string): void;
export function validateLocalLabDatabaseUrl(value: string): string;
export function databaseUrlForProcess(env?: EnvironmentMap): string;
export function createGuardedPool<TPool>(
  env: EnvironmentMap,
  createPool: (options: Record<string, unknown>) => TPool,
  options: Record<string, unknown>,
): TPool;
export function createLabTestEnvironment(sourceEnv?: EnvironmentMap): EnvironmentMap;
