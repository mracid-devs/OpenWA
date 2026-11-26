import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { OperatorService, normalizeOperatorName } from './operator.service';
import type { OperatorProfile } from './entities/operator-profile.entity';
import type { AuthService } from '../auth/auth.service';
import type { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-log.entity';
import { ApiKeyRole, type ApiKey } from '../auth/entities/api-key.entity';

const key = (id: string, role: ApiKeyRole, name = id): ApiKey => ({ id, role, name }) as unknown as ApiKey;

describe('OperatorService', () => {
  let store: Map<string, OperatorProfile>;
  let repo: Repository<OperatorProfile>;
  let logInfo: jest.Mock;
  let findOne: jest.Mock;
  let service: OperatorService;

  beforeEach(() => {
    store = new Map();
    repo = {
      findOne: jest.fn(({ where }: { where: { apiKeyId: string } }) =>
        Promise.resolve(store.get(where.apiKeyId) ?? null),
      ),
      find: jest.fn(() => Promise.resolve([...store.values()])),
      create: jest.fn((v: Partial<OperatorProfile>) => v as OperatorProfile),
      save: jest.fn((v: OperatorProfile) => {
        store.set(v.apiKeyId, { ...v, updatedAt: new Date() });
        return Promise.resolve(v);
      }),
    } as unknown as Repository<OperatorProfile>;
    logInfo = jest.fn().mockResolvedValue(null);
    findOne = jest.fn((id: string) => Promise.resolve(key(id, ApiKeyRole.OPERATOR)));
    service = new OperatorService(
      repo,
      {
        findOne,
        findAll: jest.fn().mockResolvedValue([key('a', ApiKeyRole.OPERATOR, 'Sales'), key('b', ApiKeyRole.VIEWER)]),
      } as unknown as AuthService,
      { logInfo } as unknown as AuditService,
    );
  });

  it('lets a key choose its name the first time, then locks it', async () => {
    const op = key('a', ApiKeyRole.OPERATOR);
    expect(await service.me(op)).toEqual({ apiKeyId: 'a', name: null, locked: false, canChange: true });

    expect(await service.setOwn(op, ' Viraj ')).toEqual({
      apiKeyId: 'a',
      name: 'Viraj',
      locked: true,
      canChange: false,
    });
    await expect(service.setOwn(op, 'Someone else')).rejects.toBeInstanceOf(ForbiddenException);
    expect(store.get('a')?.displayName).toBe('Viraj');
  });

  it('lets an administrator change a locked name, their own included', async () => {
    const admin = key('root', ApiKeyRole.ADMIN);
    await service.setOwn(admin, 'Boss');
    expect((await service.setOwn(admin, 'Boss 2')).name).toBe('Boss 2');
    expect((await service.me(admin)).canChange).toBe(true);
  });

  it("lets an administrator change someone else's name and records who did it", async () => {
    const admin = key('root', ApiKeyRole.ADMIN);
    await service.setOwn(key('a', ApiKeyRole.OPERATOR), 'Viraj');
    await service.setFor(admin, 'a', 'Viraj K');
    expect(store.get('a')).toMatchObject({ displayName: 'Viraj K', changedByApiKeyId: 'root' });
    const [action, context] = logInfo.mock.calls.at(-1) as [AuditAction, { metadata: Record<string, unknown> }];
    expect(action).toBe(AuditAction.OPERATOR_NAME_CHANGED);
    expect(context.metadata).toMatchObject({ from: 'Viraj', to: 'Viraj K', targetApiKeyId: 'a' });
  });

  it('writes nothing and audits nothing when the name is unchanged', async () => {
    const admin = key('root', ApiKeyRole.ADMIN);
    await service.setOwn(admin, 'Boss');
    logInfo.mockClear();
    await service.setOwn(admin, 'Boss');
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('lists every key with its chosen name, or null while it has none', async () => {
    await service.setOwn(key('a', ApiKeyRole.OPERATOR), 'Viraj');
    const rows = await service.list();
    expect(rows.map(r => [r.apiKeyId, r.apiKeyName, r.name])).toEqual([
      ['a', 'Sales', 'Viraj'],
      ['b', 'b', null],
    ]);
  });

  it.each(['', '   ', 'a*b', 'a_b', 'a`b', 'x'.repeat(41), 'bad\u0007name'])('refuses the name %j', raw => {
    expect(() => normalizeOperatorName(raw)).toThrow(BadRequestException);
  });

  it('collapses runs of whitespace', () => {
    expect(normalizeOperatorName('  Viraj   K  ')).toBe('Viraj K');
  });
});
