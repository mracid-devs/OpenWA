import { DataSource } from 'typeorm';
import { AddOperatorAndPortalLog1792100000000 } from '../1792100000000-AddOperatorAndPortalLog';

describe('AddOperatorAndPortalLog migration', () => {
  let ds: DataSource;

  beforeEach(async () => {
    ds = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await ds.initialize();
  });

  afterEach(async () => {
    await ds.destroy();
  });

  const tables = async (): Promise<string[]> => {
    const rows = await ds.query<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('operator_profiles','portal_log_settings') ORDER BY name`,
    );
    return rows.map(r => r.name);
  };

  it('creates both tables with usable defaults, is idempotent, and down() reverses it', async () => {
    const runner = ds.createQueryRunner();
    const migration = new AddOperatorAndPortalLog1792100000000();

    await migration.up(runner);
    expect(await tables()).toEqual(['operator_profiles', 'portal_log_settings']);

    await runner.query(`INSERT INTO "operator_profiles" ("apiKeyId","displayName") VALUES ('k1','Viraj')`);
    await runner.query(`INSERT INTO "portal_log_settings" ("id") VALUES ('default')`);
    const settings = (await ds.query<Array<{ enabled: number }>>(`SELECT "enabled" FROM "portal_log_settings"`))[0];
    expect(settings.enabled).toBe(0);

    await expect(migration.up(runner)).resolves.toBeUndefined();

    await migration.down(runner);
    expect(await tables()).toEqual([]);
    await runner.release();
  });
});
