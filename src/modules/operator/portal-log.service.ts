import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createLogger } from '../../common/services/logger.service';
import { PortalLogSettings, PORTAL_LOG_SETTINGS_ID } from './entities/portal-log-settings.entity';
import { OperatorService } from './operator.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditLog } from '../audit/entities/audit-log.entity';
import { MessageService } from '../message/message.service';
import { SessionService } from '../session/session.service';
import type { ApiKey } from '../auth/entities/api-key.entity';
import type { UpdatePortalLogDto } from './dto/operator.dto';

/** Gap between two posts to the group, so a burst of events never reads as spam to WhatsApp. */
export const POST_GAP_MS = 1500;
/** Events waiting to be posted; past this the oldest are dropped, so a dead session cannot grow the queue. */
export const QUEUE_MAX = 100;
/** One failed sign-in report per client address in this window; a guessing run would otherwise flood the group. */
export const AUTH_FAILED_WINDOW_MS = 5 * 60 * 1000;

const META = (entry: AuditLog, key: string): string | undefined => {
  const v = entry.metadata?.[key];
  return typeof v === 'string' && v ? v : undefined;
};

/**
 * Mirrors the portal's important events to one WhatsApp group: dashboard sign-ins and sign-outs, operator
 * name changes, API key and session changes, and the like. It listens to the audit log, so any action
 * that is audited and listed in `describe` is reported without the call site knowing about it.
 */
@Injectable()
export class PortalLogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('PortalLogService');
  private unsubscribe?: () => void;
  private queue: string[] = [];
  private draining = false;
  private timer?: NodeJS.Timeout;
  private cached?: PortalLogSettings | null;
  private readonly authFailedAt = new Map<string, number>();

  constructor(
    @InjectRepository(PortalLogSettings, 'data')
    private readonly settingsRepo: Repository<PortalLogSettings>,
    private readonly auditService: AuditService,
    private readonly operatorService: OperatorService,
    private readonly messageService: MessageService,
    private readonly sessionService: SessionService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.auditService.addListener(entry => {
      void this.handle(entry).catch(err =>
        this.logger.warn(`Portal log skipped ${entry.action}: ${err instanceof Error ? err.message : String(err)}`),
      );
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.timer) clearTimeout(this.timer);
    this.queue = [];
  }

  async getSettings(): Promise<PortalLogSettings> {
    if (this.cached === undefined) {
      this.cached = await this.settingsRepo.findOne({ where: { id: PORTAL_LOG_SETTINGS_ID } });
    }
    return (
      this.cached ??
      this.settingsRepo.create({
        id: PORTAL_LOG_SETTINGS_ID,
        enabled: false,
        sessionId: null,
        groupId: null,
        groupName: null,
      })
    );
  }

  async update(actor: ApiKey, dto: UpdatePortalLogDto, ctx: { ipAddress?: string; method?: string; path?: string }) {
    const sessionId = dto.sessionId ?? null;
    const groupId = dto.groupId ?? null;
    if (dto.enabled && (!sessionId || !groupId)) {
      throw new BadRequestException('Choose the session and the group before turning the activity log on');
    }
    if (sessionId) await this.sessionService.findOne(sessionId); // 404 for a session that does not exist
    const saved = await this.settingsRepo.save(
      this.settingsRepo.create({
        id: PORTAL_LOG_SETTINGS_ID,
        enabled: dto.enabled,
        sessionId,
        groupId,
        groupName: dto.groupName ?? null,
      }),
    );
    this.cached = saved;
    await this.auditService.logInfo(AuditAction.PORTAL_LOG_CONFIG_UPDATED, {
      apiKey: actor,
      ...ctx,
      metadata: { enabled: dto.enabled, sessionId, groupId, groupName: dto.groupName ?? null },
    });
    return saved;
  }

  /** Posts a line straight to the group, so the choice can be tried before relying on it. */
  async sendTest(actor: ApiKey): Promise<void> {
    const s = await this.getSettings();
    if (!s.sessionId || !s.groupId) {
      throw new BadRequestException('Choose and save the session and the group first');
    }
    await this.messageService.sendText(s.sessionId, {
      chatId: s.groupId,
      text: `✅ *Business Advisor CRM*\nTest message: portal activity will be posted here.\nSent by ${actor.name} · ${this.stamp(new Date())}`,
    });
  }

  private stamp(at: Date | string): string {
    const d = at instanceof Date ? at : new Date(at);
    return d.toLocaleString('en-GB', {
      timeZone: process.env.TZ || 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  private async handle(entry: AuditLog): Promise<void> {
    const settings = await this.getSettings();
    if (!settings.enabled || !settings.sessionId || !settings.groupId) return;
    const text = await this.describe(entry);
    if (text) this.enqueue(text);
  }

  /** The line to post for an audit row, or null when the action is not worth a notification. */
  private async describe(entry: AuditLog): Promise<string | null> {
    const key = entry.apiKeyName ?? 'unknown key';
    const opName = await this.operatorService.getName(entry.apiKeyId);
    const who = opName ? `*${opName}* (${key})` : `*${key}*`;
    const session = entry.sessionName ? ` “${entry.sessionName}”` : '';
    const ip = entry.ipAddress ? ` · IP ${entry.ipAddress}` : '';
    const when = this.stamp(entry.createdAt);
    const line = (icon: string, what: string) => `${icon} ${what}\n🕒 ${when}${ip}`;

    switch (entry.action) {
      case AuditAction.DASHBOARD_LOGIN:
        return line('🔓', `${who} logged in`);
      case AuditAction.DASHBOARD_LOGOUT:
        return line('🔒', `${who} logged out`);
      case AuditAction.OPERATOR_NAME_CHANGED: {
        const target = META(entry, 'targetApiKeyName') ?? 'a key';
        const from = META(entry, 'from');
        const to = META(entry, 'to') ?? '';
        return line(
          '✏️',
          `${who} ${from ? `changed the name of ${target} from *${from}* to *${to}*` : `set the name of ${target} to *${to}*`}`,
        );
      }
      case AuditAction.API_KEY_CREATED:
        return line('🔑', `${who} created an API key${META(entry, 'name') ? ` “${META(entry, 'name')}”` : ''}`);
      case AuditAction.API_KEY_UPDATED:
        return line('🔑', `${who} updated an API key`);
      case AuditAction.API_KEY_REVOKED:
        return line('🚫', `${who} revoked an API key`);
      case AuditAction.API_KEY_DELETED:
        return line('🗑️', `${who} deleted an API key`);
      case AuditAction.API_KEY_AUTH_FAILED: {
        const ipKey = entry.ipAddress ?? 'unknown';
        const last = this.authFailedAt.get(ipKey) ?? 0;
        const now = Date.now();
        if (now - last < AUTH_FAILED_WINDOW_MS) return null;
        this.authFailedAt.set(ipKey, now);
        if (this.authFailedAt.size > 500) this.authFailedAt.clear();
        return line('⚠️', 'Failed sign-in attempt with an invalid API key');
      }
      case AuditAction.SESSION_CREATED:
        return line('📱', `${who} created session${session}`);
      case AuditAction.SESSION_STARTED:
        return line('▶️', `${who} started session${session}`);
      case AuditAction.SESSION_STOPPED:
        return line('⏹️', `${who} stopped session${session}`);
      case AuditAction.SESSION_LOGGED_OUT:
        return line('📴', `${who} logged out WhatsApp on session${session}`);
      case AuditAction.SESSION_DELETED:
        return line('🗑️', `${who} deleted session${session}`);
      case AuditAction.SESSION_DISCONNECTED:
        return line('🔌', `Session${session} was disconnected`);
      case AuditAction.SESSION_RESTRICTED:
        return line('🚨', `WhatsApp restricted session${session}`);
      case AuditAction.WEBHOOK_CREATED:
      case AuditAction.WEBHOOK_DELETED:
        return line('🪝', `${who} ${entry.action === AuditAction.WEBHOOK_CREATED ? 'created' : 'deleted'} a webhook`);
      case AuditAction.PLUGIN_INSTALLED:
      case AuditAction.PLUGIN_UNINSTALLED:
        return line(
          '🧩',
          `${who} ${entry.action === AuditAction.PLUGIN_INSTALLED ? 'installed' : 'uninstalled'} a plugin`,
        );
      case AuditAction.INFRA_CONFIG_SAVED:
      case AuditAction.INFRA_RESTART_REQUESTED:
      case AuditAction.INFRA_DATA_IMPORTED:
        return line('🛠️', `${who} changed infrastructure (${entry.action.replace('infra_', '').replace(/_/g, ' ')})`);
      case AuditAction.PORTAL_LOG_CONFIG_UPDATED:
        return line('⚙️', `${who} updated the activity log settings`);
      default:
        return null;
    }
  }

  private enqueue(text: string): void {
    this.queue.push(text);
    if (this.queue.length > QUEUE_MAX) this.queue.splice(0, this.queue.length - QUEUE_MAX);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const settings = await this.getSettings();
        if (!settings.enabled || !settings.sessionId || !settings.groupId) {
          this.queue = [];
          break;
        }
        const text = this.queue.shift() as string;
        try {
          await this.messageService.sendText(settings.sessionId, { chatId: settings.groupId, text });
        } catch (err) {
          // A session that is not ready (or a group that is gone) must not block the portal: drop and move on.
          this.logger.warn(`Portal log post failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (this.queue.length > 0) await new Promise<void>(resolve => (this.timer = setTimeout(resolve, POST_GAP_MS)));
      }
    } finally {
      this.draining = false;
    }
  }
}
