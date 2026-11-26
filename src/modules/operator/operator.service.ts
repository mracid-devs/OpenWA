import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperatorProfile } from './entities/operator-profile.entity';
import { AuthService } from '../auth/auth.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { type ApiKey, ApiKeyRole } from '../auth/entities/api-key.entity';
import { OPERATOR_NAME_MAX } from './dto/operator.dto';

export const NAME_LOCKED_MESSAGE =
  'This name is already set and can only be changed by an administrator. Ask an administrator to change it.';

interface RequestContext {
  ipAddress?: string;
  method?: string;
  path?: string;
}

/** A name that fits on one line and cannot break the bold markup the replies put it in. */
export function normalizeOperatorName(raw: string): string {
  const name = raw.replace(/\s+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex -- a name with control characters is refused, not cleaned
  if (/[\u0000-\u001f\u007f*_~`]/.test(raw.replace(/\s+/g, ' '))) {
    throw new BadRequestException('The name cannot contain * _ ~ ` or control characters');
  }
  if (!name) throw new BadRequestException('The name cannot be empty');
  if ([...name].length > OPERATOR_NAME_MAX) {
    throw new BadRequestException(`The name can be at most ${OPERATOR_NAME_MAX} characters`);
  }
  return name;
}

@Injectable()
export class OperatorService {
  constructor(
    @InjectRepository(OperatorProfile, 'data')
    private readonly profiles: Repository<OperatorProfile>,
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  get(apiKeyId: string): Promise<OperatorProfile | null> {
    return this.profiles.findOne({ where: { apiKeyId } });
  }

  async getName(apiKeyId: string | null | undefined): Promise<string | null> {
    if (!apiKeyId) return null;
    return (await this.get(apiKeyId))?.displayName ?? null;
  }

  async me(actor: ApiKey) {
    const profile = await this.get(actor.id);
    const locked = !!profile;
    return {
      apiKeyId: actor.id,
      name: profile?.displayName ?? null,
      locked,
      canChange: !locked || actor.role === ApiKeyRole.ADMIN,
    };
  }

  /** Every key, with the name it signs replies with (null while it has not chosen one). */
  async list() {
    const [keys, profiles] = await Promise.all([this.authService.findAll(), this.profiles.find()]);
    const byKey = new Map(profiles.map(p => [p.apiKeyId, p]));
    return keys.map(k => ({
      apiKeyId: k.id,
      apiKeyName: k.name,
      name: byKey.get(k.id)?.displayName ?? null,
      updatedAt: byKey.get(k.id)?.updatedAt,
    }));
  }

  /**
   * A key sets its own name. The first time is open to everyone; once a name exists only an administrator
   * (changing their own, or anyone's through setFor) can replace it.
   */
  async setOwn(actor: ApiKey, rawName: string, ctx: RequestContext = {}) {
    const name = normalizeOperatorName(rawName);
    const existing = await this.get(actor.id);
    if (existing && actor.role !== ApiKeyRole.ADMIN) {
      throw new ForbiddenException(NAME_LOCKED_MESSAGE);
    }
    return this.save(actor, actor, existing, name, ctx);
  }

  /** An administrator sets the name of any key. */
  async setFor(actor: ApiKey, apiKeyId: string, rawName: string, ctx: RequestContext = {}) {
    const name = normalizeOperatorName(rawName);
    const target = await this.authService.findOne(apiKeyId); // 404 for a key that does not exist
    const existing = await this.get(apiKeyId);
    return this.save(actor, target, existing, name, ctx);
  }

  private async save(
    actor: ApiKey,
    target: ApiKey,
    existing: OperatorProfile | null,
    name: string,
    ctx: RequestContext,
  ) {
    if (existing?.displayName === name) return this.me(target);
    await this.profiles.save(
      this.profiles.create({
        apiKeyId: target.id,
        displayName: name,
        changedByApiKeyId: actor.id,
      }),
    );
    await this.auditService.logInfo(AuditAction.OPERATOR_NAME_CHANGED, {
      apiKey: actor,
      ...ctx,
      metadata: {
        targetApiKeyId: target.id,
        targetApiKeyName: target.name,
        from: existing?.displayName ?? null,
        to: name,
      },
    });
    return this.me(target);
  }
}
