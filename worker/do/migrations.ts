export type SqlMigration = string[];

const MIGRATION_VERSION_KEY = "dbMigrationVersion";
const BACKFILL_STATE_KEY = "dbBackfillState";

export async function runSqlMigrations(
  state: DurableObjectState,
  migrations: SqlMigration[],
): Promise<void> {
  const currentVersion = (await state.storage.get<number>(MIGRATION_VERSION_KEY)) ?? 0;
  for (let version = currentVersion; version < migrations.length; version += 1) {
    for (const statement of migrations[version]) {
      state.storage.sql.exec(statement);
    }
    await state.storage.put(MIGRATION_VERSION_KEY, version + 1);
  }
}

export async function backfill(
  state: DurableObjectState,
  uniqueStr: string,
  fn: () => Promise<null>,
): Promise<void> {
  const currentBackfill = await state.storage.get<string>(BACKFILL_STATE_KEY);
  if (currentBackfill === uniqueStr) {
    return;
  }

  await fn();
  await state.storage.put(BACKFILL_STATE_KEY, uniqueStr);
}
