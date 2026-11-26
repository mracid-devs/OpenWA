import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `operator_profiles` (the name each API key signs its dashboard replies with, locked once set) and
 * `portal_log_settings` (the WhatsApp group that mirrors portal activity).
 *
 * Hand-authored because `synchronize` is disabled for the `data` connection on PostgreSQL and in
 * production SQLite. The hasTable guards make it safe on a database a synchronize run already built.
 */
export class AddOperatorAndPortalLog1792100000000 implements MigrationInterface {
  name = 'AddOperatorAndPortalLog1792100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';
    const now = isPostgres ? 'NOW()' : "(datetime('now'))";
    const ts = isPostgres ? 'timestamp' : 'datetime';
    const falseValue = isPostgres ? 'false' : '0';

    if (!(await queryRunner.hasTable('operator_profiles'))) {
      await queryRunner.query(
        `CREATE TABLE "operator_profiles" ("apiKeyId" varchar(36) PRIMARY KEY NOT NULL, "displayName" varchar(40) NOT NULL, "changedByApiKeyId" varchar(36), "createdAt" ${ts} NOT NULL DEFAULT ${now}, "updatedAt" ${ts} NOT NULL DEFAULT ${now})`,
      );
    }

    if (!(await queryRunner.hasTable('portal_log_settings'))) {
      await queryRunner.query(
        `CREATE TABLE "portal_log_settings" ("id" varchar(20) PRIMARY KEY NOT NULL, "enabled" boolean NOT NULL DEFAULT ${falseValue}, "sessionId" varchar(36), "groupId" varchar(100), "groupName" varchar(200), "updatedAt" ${ts} NOT NULL DEFAULT ${now})`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "portal_log_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "operator_profiles"`);
  }
}
