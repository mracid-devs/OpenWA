import { Entity, Column, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const PORTAL_LOG_SETTINGS_ID = 'default';

/**
 * Where portal activity (sign-ins, sign-outs, name changes, key and session changes) is mirrored:
 * one WhatsApp group, reached through one session. A single row, id `default`.
 */
@Entity('portal_log_settings')
export class PortalLogSettings {
  @PrimaryColumn({ type: 'varchar', length: 20 })
  id!: string;

  @Column({ type: 'boolean', default: false })
  enabled!: boolean;

  @Column({ type: 'varchar', length: 36, nullable: true })
  sessionId!: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  groupId!: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  groupName!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
