import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import { useRole } from '../hooks/useRole';
import { operatorMeKey, useOperatorProfile } from '../hooks/useOperatorProfile';
import { useSessionsQuery } from '../hooks/queries';
import { operatorApi, sessionApi, type OperatorProfileRow } from '../services/api';
import {
  TAGS_MAX,
  TAG_NAME_MAX,
  USERNAME_MAX,
  newTagId,
  prefixWithUsername,
  resetTags,
  setTags,
  useOperatorSettings,
} from '../utils/operatorSettings';
import './Settings.css';

// The group the portal's activity is meant to land in; picked automatically when a session has it.
const DEFAULT_LOG_GROUP = 'BA Whatsapp Logs';

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

function ProfileRow({
  row,
  onSave,
  saving,
}: {
  row: OperatorProfileRow;
  onSave: (name: string) => void;
  saving: boolean;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(row.name ?? '');
  useEffect(() => setName(row.name ?? ''), [row.name]);
  const changed = name.trim() !== (row.name ?? '') && name.trim().length > 0;
  return (
    <li>
      <span className="os-key" title={row.apiKeyId}>
        {row.apiKeyName ?? row.apiKeyId}
      </span>
      <input
        className="os-input"
        aria-label={t('settings.operatorName')}
        value={name}
        maxLength={USERNAME_MAX}
        placeholder={t('settings.notSet')}
        onChange={e => setName(e.target.value)}
      />
      <button className="btn-secondary" type="button" disabled={!changed || saving} onClick={() => onSave(name)}>
        {t('settings.save')}
      </button>
    </li>
  );
}

export function Settings() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.settings'));
  const toast = useToast();
  const queryClient = useQueryClient();
  const { role, scoped } = useRole();
  const isAdmin = role === 'admin' && !scoped;
  const tagSettings = useOperatorSettings();

  // ---- Username (kept on the server; locked once set) -------------------------------------------
  const me = useOperatorProfile();
  const [name, setName] = useState('');
  useEffect(() => setName(me.data?.name ?? ''), [me.data?.name]);
  const canChange = me.data?.canChange ?? false;
  const locked = me.data?.locked ?? false;

  const saveName = useMutation({
    mutationFn: (value: string) => operatorApi.setMe(value),
    onSuccess: data => {
      queryClient.setQueryData(operatorMeKey, data);
      void queryClient.invalidateQueries({ queryKey: ['operator', 'profiles'] });
      toast.success(t('settings.saved'));
    },
    onError: err => toast.error(t('settings.saveFailed'), messageOf(err)),
  });

  // ---- Operators (admin) ------------------------------------------------------------------------
  const profiles = useQuery({
    queryKey: ['operator', 'profiles'],
    queryFn: operatorApi.profiles,
    enabled: isAdmin,
  });
  const saveFor = useMutation({
    mutationFn: ({ apiKeyId, value }: { apiKeyId: string; value: string }) => operatorApi.setFor(apiKeyId, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['operator'] });
      toast.success(t('settings.saved'));
    },
    onError: err => toast.error(t('settings.saveFailed'), messageOf(err)),
  });

  // ---- WhatsApp activity log (admin) ------------------------------------------------------------
  const { data: sessions = [] } = useSessionsQuery();
  const readySessions = useMemo(() => sessions.filter(s => s.status === 'ready'), [sessions]);
  const portal = useQuery({
    queryKey: ['operator', 'portal-log'],
    queryFn: operatorApi.getPortalLog,
    enabled: isAdmin,
  });
  const [logEnabled, setLogEnabled] = useState(false);
  const [logSession, setLogSession] = useState('');
  const [logGroup, setLogGroup] = useState('');
  useEffect(() => {
    if (!portal.data) return;
    setLogEnabled(portal.data.enabled);
    setLogSession(portal.data.sessionId ?? '');
    setLogGroup(portal.data.groupId ?? '');
  }, [portal.data]);
  const sessionId = readySessions.some(s => s.id === logSession) ? logSession : (readySessions[0]?.id ?? '');
  const groups = useQuery({
    queryKey: ['operator', 'portal-log-groups', sessionId],
    queryFn: () => sessionApi.getGroups(sessionId),
    enabled: isAdmin && !!sessionId,
  });
  // With nothing chosen yet, preselect the group the log is meant for.
  useEffect(() => {
    if (logGroup || !groups.data) return;
    const wanted = groups.data.find(g => (g.name ?? '').trim().toLowerCase() === DEFAULT_LOG_GROUP.toLowerCase());
    if (wanted) setLogGroup(wanted.id);
  }, [groups.data, logGroup]);
  const chosenGroup = groups.data?.find(g => g.id === logGroup);

  const savePortal = useMutation({
    mutationFn: () =>
      operatorApi.setPortalLog({
        enabled: logEnabled,
        sessionId: sessionId || null,
        groupId: logGroup || null,
        groupName: chosenGroup?.name ?? portal.data?.groupName ?? null,
      }),
    onSuccess: data => {
      queryClient.setQueryData(['operator', 'portal-log'], data);
      toast.success(t('settings.saved'));
    },
    onError: err => toast.error(t('settings.saveFailed'), messageOf(err)),
  });
  const testPortal = useMutation({
    mutationFn: operatorApi.testPortalLog,
    onSuccess: () => toast.success(t('settings.logTestSent')),
    onError: err => toast.error(t('settings.logTestFailed'), messageOf(err)),
  });
  const logDirty =
    !!portal.data &&
    (portal.data.enabled !== logEnabled ||
      (portal.data.sessionId ?? '') !== sessionId ||
      (portal.data.groupId ?? '') !== logGroup);

  const updateTag = (id: string, patch: { name?: string; color?: string }) =>
    setTags(tagSettings.tags.map(tag => (tag.id === id ? { ...tag, ...patch } : tag)));

  return (
    <div className="operator-settings">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />

      <section className="os-card">
        <h2>{t('settings.usernameTitle')}</h2>
        <p className="os-muted">{t('settings.usernameHelp')}</p>
        <label className="os-label" htmlFor="os-username">
          {t('settings.username')}
        </label>
        <div className="os-inline">
          <input
            id="os-username"
            className="os-input"
            value={name}
            maxLength={USERNAME_MAX}
            placeholder="Viraj"
            disabled={me.isLoading || !canChange}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && canChange && name.trim()) saveName.mutate(name);
            }}
          />
          <button
            className="btn-primary"
            type="button"
            disabled={!canChange || !name.trim() || name.trim() === (me.data?.name ?? '') || saveName.isPending}
            onClick={() => saveName.mutate(name)}
          >
            {t('settings.save')}
          </button>
        </div>
        {!locked && me.data && <p className="os-muted">{t('settings.nameOnce')}</p>}
        {locked && !canChange && (
          <p className="os-note">
            <Lock size={14} /> {t('settings.nameLocked')}
          </p>
        )}
        {locked && canChange && <p className="os-muted">{t('settings.nameAdminCanChange')}</p>}
        {me.isError && <p className="os-error">{t('settings.loadFailed')}</p>}
        <p className="os-muted">
          {t('settings.preview')}: <strong>{prefixWithUsername(t('settings.previewText'), name) || '—'}</strong>
        </p>
      </section>

      {isAdmin && (
        <section className="os-card">
          <h2>{t('settings.operatorsTitle')}</h2>
          <p className="os-muted">{t('settings.operatorsHelp')}</p>
          {profiles.isLoading && <p className="os-muted">{t('settings.loading')}</p>}
          {profiles.isError && <p className="os-error">{t('settings.loadFailed')}</p>}
          <ul className="os-tags os-operators">
            {profiles.data?.map(row => (
              <ProfileRow
                key={row.apiKeyId}
                row={row}
                saving={saveFor.isPending}
                onSave={value => saveFor.mutate({ apiKeyId: row.apiKeyId, value })}
              />
            ))}
          </ul>
        </section>
      )}

      {isAdmin && (
        <section className="os-card">
          <h2>{t('settings.logTitle')}</h2>
          <p className="os-muted">{t('settings.logHelp', { group: DEFAULT_LOG_GROUP })}</p>
          <label className="os-check">
            <input type="checkbox" checked={logEnabled} onChange={e => setLogEnabled(e.target.checked)} />
            {t('settings.logEnable')}
          </label>
          <label className="os-label" htmlFor="os-log-session">
            {t('settings.logSession')}
          </label>
          <select
            id="os-log-session"
            className="os-input"
            value={sessionId}
            onChange={e => {
              setLogSession(e.target.value);
              setLogGroup('');
            }}
          >
            {readySessions.length === 0 && <option value="">{t('settings.logNoSession')}</option>}
            {readySessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <label className="os-label" htmlFor="os-log-group">
            {t('settings.logGroup')}
          </label>
          <select
            id="os-log-group"
            className="os-input"
            value={logGroup}
            disabled={!sessionId || groups.isLoading}
            onChange={e => setLogGroup(e.target.value)}
          >
            <option value="">{groups.isLoading ? t('settings.loading') : t('settings.logChooseGroup')}</option>
            {groups.data?.map(g => (
              <option key={g.id} value={g.id}>
                {g.name ?? g.id}
              </option>
            ))}
          </select>
          {sessionId &&
            groups.data &&
            !groups.data.some(g => (g.name ?? '').toLowerCase() === DEFAULT_LOG_GROUP.toLowerCase()) && (
              <p className="os-muted">{t('settings.logGroupMissing', { group: DEFAULT_LOG_GROUP })}</p>
            )}
          <div className="os-inline">
            <button
              className="btn-primary"
              type="button"
              disabled={savePortal.isPending || (logEnabled && (!sessionId || !logGroup))}
              onClick={() => savePortal.mutate()}
            >
              {t('settings.save')}
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={testPortal.isPending || logDirty || !portal.data?.groupId}
              onClick={() => testPortal.mutate()}
            >
              <Send size={14} /> {t('settings.logTest')}
            </button>
          </div>
          <p className="os-muted">{t('settings.logEvents')}</p>
        </section>
      )}

      <section className="os-card">
        <h2>{t('settings.tagsTitle')}</h2>
        <p className="os-muted">{t('settings.tagsHelp')}</p>
        <ul className="os-tags">
          {tagSettings.tags.map(tag => (
            <li key={tag.id}>
              <input
                type="color"
                className="os-color"
                aria-label={t('settings.tagColor')}
                value={tag.color}
                onChange={e => updateTag(tag.id, { color: e.target.value })}
              />
              <input
                className="os-input"
                aria-label={t('settings.tagName')}
                value={tag.name}
                maxLength={TAG_NAME_MAX}
                onChange={e => updateTag(tag.id, { name: e.target.value })}
                onBlur={() => {
                  if (!tag.name.trim()) updateTag(tag.id, { name: t('settings.untitledTag') });
                }}
              />
              <button
                className="btn-secondary"
                type="button"
                aria-label={t('settings.removeTag')}
                title={t('settings.removeTag')}
                onClick={() => setTags(tagSettings.tags.filter(x => x.id !== tag.id))}
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
        <div className="os-inline">
          <button
            className="btn-secondary"
            type="button"
            disabled={tagSettings.tags.length >= TAGS_MAX}
            onClick={() =>
              setTags([...tagSettings.tags, { id: newTagId(), name: t('settings.newTag'), color: '#64748b' }])
            }
          >
            <Plus size={14} /> {t('settings.addTag')}
          </button>
          <button className="btn-secondary" type="button" onClick={resetTags}>
            <RotateCcw size={14} /> {t('settings.resetTags')}
          </button>
        </div>
        <p className="os-muted">{t('settings.tagsBrowserOnly')}</p>
      </section>
    </div>
  );
}
