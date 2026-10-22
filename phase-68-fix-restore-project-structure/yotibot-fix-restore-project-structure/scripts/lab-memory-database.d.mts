export interface NodeTestContextLike {
  after(callback: () => void | Promise<void>): void;
}

export interface LabMemoryDatabase {
  createSchema(name: string): void;
  createTable(schema: string, table: string): void;
  insert(schema: string, table: string, row: unknown): void;
  selectAll(schema: string, table: string): unknown[];
  dropSchema(name: string): void;
  teardown(): void;
  readonly isClosed: boolean;
}

export function createLabMemoryDatabase(testContext: NodeTestContextLike): LabMemoryDatabase;
