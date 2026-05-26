export type SqlMigration = string[];

const MIGRATION_VERSION_KEY = "dbMigrationVersion";

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
