import { BadRequestException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { PortalLogService, QUEUE_MAX } from './portal-log.service';
import type { PortalLogSettings } from './entities/portal-log-settings.entity';
import type { OperatorService } from './operator.service';
import type { AuditService } from '../audit/audit.service';
import { AuditAction, type AuditLog } from '../audit/entities/audit-log.entity';
import type { MessageService } from '../message/message.service';
import type { SessionService } from '../session/session.service';
import type { ApiKey } from '../auth/entities/api-key.entity';

const settings = (over: Partial<PortalLogSettings> = {}): PortalLogSettings =>
  ({
    id: 'default',
    enabled: true,
    sessionId: 's1',
    groupId: '123@g.us',
    groupName: 'BA Whatsapp Logs',
    ...over,
  }) as PortalLogSettings;

const entry = (action: AuditAction, over: Partial<AuditLog> = {}): AuditLog =>
  ({
    action,
    apiKeyId: 'k1',
    apiKeyName: 'Sales',
    sessionName: null,
    ipAddress: '203.0.113.9',
    metadata: null,
    createdAt: new Date('2026-11-26T04:45:00Z'),
    ...over,
  }) as unknown as AuditLog;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('PortalLogService', () => {
  let current: PortalLogSettings | null;
  let sendText: jest.Mock;
  let listener: (e: AuditLog) => void;
  let service: PortalLogService;
  let repo: Repository<PortalLogSettings>;

  const build = () => {
    repo = {
      findOne: jest.fn(() => Promise.resolve(current)),
      create: jest.fn((v: Partial<PortalLogSettings>) => v as PortalLogSettings),
      save: jest.fn((v: PortalLogSettings) => {
        current = v;
        return Promise.resolve(v);
      }),
    } as unknown as Repository<PortalLogSettings>;
    service = new PortalLogService(
      repo,
      {
        addListener: jest.fn((l: (e: AuditLog) => void) => {
          listener = l;
          return () => undefined;
        }),
        logInfo: jest.fn().mockResolvedValue(null),
      } as unknown as AuditService,
      { getName: jest.fn((id: string) => Promise.resolve(id === 'k1' ? 'Viraj' : null)) } as unknown as OperatorService,
      { sendText } as unknown as MessageService,
      { findOne: jest.fn().mockResolvedValue({ id: 's1' }) } as unknown as SessionService,
    );
    service.onModuleInit();
  };

  beforeEach(() => {
    jest.useFakeTimers();
    current = settings();
    sendText = jest.fn().mockResolvedValue({});
    build();
  });
  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('posts a sign-in to the group with the operator name, key, time and address', async () => {
    listener(entry(AuditAction.DASHBOARD_LOGIN));
    await flush();
    expect(sendText).toHaveBeenCalledTimes(1);
    const [sessionId, dto] = sendText.mock.calls[0] as [string, { chatId: string; text: string }];
    expect(sessionId).toBe('s1');
    expect(dto.chatId).toBe('123@g.us');
    expect(dto.text).toContain('*Viraj* (Sales) logged in');
    expect(dto.text).toContain('26 Nov 2026');
    expect(dto.text).toContain('IP 203.0.113.9');
  });

  it('posts sign-outs and name changes', async () => {
    listener(entry(AuditAction.DASHBOARD_LOGOUT));
    await flush();
    expect((sendText.mock.calls[0] as [string, { text: string }])[1].text).toContain('logged out');
    await jest.advanceTimersByTimeAsync(2000);
    listener(
      entry(AuditAction.OPERATOR_NAME_CHANGED, {
        metadata: { targetApiKeyName: 'Sales', from: 'Viraj', to: 'Viraj K' },
      }),
    );
    await flush();
    expect((sendText.mock.calls[1] as [string, { text: string }])[1].text).toContain('from *Viraj* to *Viraj K*');
  });

  it('stays silent when the activity log is off or has no group', async () => {
    current = settings({ enabled: false });
    build();
    listener(entry(AuditAction.DASHBOARD_LOGIN));
    await flush();
    current = settings({ groupId: null });
    build();
    listener(entry(AuditAction.DASHBOARD_LOGIN));
    await flush();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('ignores actions that are not worth a notification', async () => {
    listener(entry(AuditAction.MESSAGE_SENT));
    listener(entry(AuditAction.API_KEY_USED));
    await flush();
    expect(sendText).not.toHaveBeenCalled();
  });

  it('reports a failed sign-in once per address in the window', async () => {
    listener(entry(AuditAction.API_KEY_AUTH_FAILED, { apiKeyId: null, apiKeyName: null }));
    listener(entry(AuditAction.API_KEY_AUTH_FAILED, { apiKeyId: null, apiKeyName: null }));
    await flush();
    await jest.advanceTimersByTimeAsync(2000);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('spaces posts and keeps going after a failed send', async () => {
    sendText.mockRejectedValueOnce(new Error('session not ready'));
    listener(entry(AuditAction.DASHBOARD_LOGIN));
    listener(entry(AuditAction.DASHBOARD_LOGOUT));
    await flush();
    expect(sendText).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1600);
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it('keeps at most QUEUE_MAX waiting lines', async () => {
    sendText.mockImplementation(() => new Promise(() => undefined)); // the first post never returns
    for (let i = 0; i < QUEUE_MAX + 30; i++) listener(entry(AuditAction.DASHBOARD_LOGIN));
    await flush();
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('refuses to turn the log on without a session and a group', async () => {
    const actor = { id: 'root', name: 'Admin' } as ApiKey;
    await expect(service.update(actor, { enabled: true, sessionId: 's1' }, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.update(actor, { enabled: true, groupId: '1@g.us' }, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('saves the target and uses it straight away', async () => {
    current = null;
    build();
    const actor = { id: 'root', name: 'Admin' } as ApiKey;
    await service.update(
      actor,
      { enabled: true, sessionId: 's1', groupId: '9@g.us', groupName: 'BA Whatsapp Logs' },
      {},
    );
    listener(entry(AuditAction.DASHBOARD_LOGIN));
    await flush();
    expect((sendText.mock.calls[0] as [string, { chatId: string }])[1].chatId).toBe('9@g.us');
  });

  it('sends a test line only once a target is saved', async () => {
    const actor = { id: 'root', name: 'Admin' } as ApiKey;
    current = settings({ groupId: null });
    build();
    await expect(service.sendTest(actor)).rejects.toBeInstanceOf(BadRequestException);
    current = settings();
    build();
    await service.sendTest(actor);
    expect((sendText.mock.calls[0] as [string, { text: string }])[1].text).toContain('Test message');
  });
});
