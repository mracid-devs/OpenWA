import { Entity, Column, PrimaryColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * The name an operator (one API key) puts at the start of the replies they send from the dashboard.
 * A row exists once the name has been chosen; from then on only an administrator can change it.
 * Keyed by the API key id. The key lives in the main database, so there is no foreign key here.
 */
@Entity('operator_profiles')
export class OperatorProfile {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  apiKeyId!: string;

  @Column({ type: 'varchar', length: 40 })
  displayName!: string;

  /** The key that made the last change: the operator themselves, or the administrator who overrode it. */
  @Column({ type: 'varchar', length: 36, nullable: true })
  changedByApiKeyId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
