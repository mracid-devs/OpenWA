import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Megaphone, CheckCircle2, XCircle, Loader2, Send, Square, Search, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSessionsQuery } from '../hooks/queries';
import { useRole } from '../hooks/useRole';
import { useToast } from '../hooks/useToast';
import { messageApi, sessionApi, type BatchStatusResponse } from '../services/api';
import './Broadcast.css';

// Spacing between groups. Bursts of identical messages are what get accounts flagged, so there is no "0".
const DELAYS_SECONDS = [3, 5, 10, 20];
// The server's cap on recipients in one batch (BULK_MESSAGES_MAX).
const MAX_GROUPS = 100;
const STORAGE_KEY = 'broadcast-active-batch';

interface StoredBatch {
  sessionId: string;
  batchId: string;
  names: Record<string, string>;
}

// The batch runs on the server, so it keeps going when this tab closes. Remembering its id here is
// what lets the page pick the run back up on the next visit.
const loadStored = (): StoredBatch | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredBatch) : null;
  } catch {
    return null;
  }
};
const saveStored = (value: StoredBatch | null) => {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: the run still works, it just is not resumed after a reload */
  }
};

const isTerminal = (status: string) => status === 'completed' || status === 'cancelled' || status === 'failed';

export function Broadcast() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.broadcast'));
  const toast = useToast();
  const { canWrite } = useRole();

  const { data: sessions = [] } = useSessionsQuery();
  const readySessions = useMemo(() => sessions.filter(s => s.status === 'ready'), [sessions]);

  const [active, setActive] = useState<StoredBatch | null>(loadStored);
  const [chosen, setChosen] = useState(() => active?.sessionId ?? '');
  const sessionId = readySessions.some(s => s.id === chosen) ? chosen : (readySessions[0]?.id ?? '');

  const {
    data: groups = [],
    isLoading: loadingGroups,
    error: groupsError,
    refetch,
  } = useQuery({
    queryKey: ['broadcast-groups', sessionId],
    queryFn: () => sessionApi.getGroups(sessionId),
    enabled: !!sessionId,
    staleTime: 60_000,
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [text, setText] = useState('');
  const [delay, setDelay] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);

  // A selection from another session's groups means nothing here.
  useEffect(() => {
    setSelected(new Set());
  }, [sessionId]);

  // Poll the server-side batch until it reaches a terminal status.
  const { data: batch, error: batchError } = useQuery<BatchStatusResponse>({
    queryKey: ['broadcast-batch', active?.sessionId, active?.batchId],
    queryFn: () => messageApi.getBatchStatus(active!.sessionId, active!.batchId),
    enabled: !!active,
    refetchInterval: query => (query.state.data && isTerminal(query.state.data.status) ? false : 2000),
  });

  const running = !!active && (!batch || !isTerminal(batch.status));

  // A batch the server no longer knows (purged, or a different install) must not pin the page forever.
  useEffect(() => {
    if (active && batchError && !batch) {
      saveStored(null);
      setActive(null);
    }
  }, [active, batchError, batch]);

  // Announce the end of a run once, when the poll first sees a terminal status.
  const finishedId = batch && isTerminal(batch.status) ? batch.batchId : null;
  useEffect(() => {
    if (!finishedId || !batch) return;
    const { sent, failed } = batch.progress;
    if (batch.status === 'completed' && failed === 0) {
      toast.success(t('broadcast.doneTitle'), t('broadcast.doneAll', { n: sent }));
    } else {
      toast.warning(t('broadcast.doneTitle'), t('broadcast.doneSome', { sent, failed }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per finished batch id
  }, [finishedId]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return groups.filter(g => !q || (g.name ?? g.id).toLowerCase().includes(q));
  }, [groups, filter]);
  const allVisibleSelected = visible.length > 0 && visible.every(g => selected.has(g.id));

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_GROUPS) next.add(id);
      return next;
    });
  const toggleAllVisible = () =>
    setSelected(prev => {
      const next = new Set(prev);
      for (const g of visible) {
        if (allVisibleSelected) next.delete(g.id);
        else if (next.size < MAX_GROUPS) next.add(g.id);
      }
      return next;
    });

  const canSend = canWrite && !!sessionId && selected.size > 0 && text.trim().length > 0 && !running && !submitting;

  const handleSend = async () => {
    if (!canSend) return;
    if (!window.confirm(t('broadcast.confirm', { n: selected.size }))) return;
    const targets = groups.filter(g => selected.has(g.id));
    setSubmitting(true);
    try {
      const res = await messageApi.sendBulk(sessionId, {
        messages: targets.map(g => ({ chatId: g.id, type: 'text' as const, content: { text: text.trim() } })),
        options: { delayBetweenMessages: delay * 1000, randomizeDelay: true, stopOnError: false },
      });
      const next: StoredBatch = {
        sessionId,
        batchId: res.batchId,
        names: Object.fromEntries(targets.map(g => [g.id, g.name ?? g.id])),
      };
      saveStored(next);
      setActive(next);
      toast.info(t('broadcast.started'), t('broadcast.startedBody'));
    } catch (err) {
      toast.error(t('broadcast.startFailed'), err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleStop = async () => {
    if (!active) return;
    setStopping(true);
    try {
      await messageApi.cancelBatch(active.sessionId, active.batchId);
    } catch (err) {
      toast.error(t('broadcast.stopFailed'), err instanceof Error ? err.message : String(err));
    } finally {
      setStopping(false);
    }
  };

  const handleClear = () => {
    saveStored(null);
    setActive(null);
  };

  // Rows: every recipient of the batch, with the attempted ones carrying their outcome.
  const rows = useMemo(() => {
    if (!active) return [];
    const byChat = new Map((batch?.results ?? []).map(r => [r.chatId, r]));
    return Object.entries(active.names).map(([id, name]) => {
      const r = byChat.get(id);
      return { id, name, status: r?.status ?? 'pending', error: r?.error?.message };
    });
  }, [active, batch]);

  const sentCount = batch?.progress.sent ?? 0;
  const failedCount = batch?.progress.failed ?? 0;

  return (
    <div className="broadcast">
      <PageHeader title={t('broadcast.title')} subtitle={t('broadcast.subtitle')} />

      {readySessions.length === 0 && !active ? (
        <div className="bc-empty">{t('broadcast.noSession')}</div>
      ) : (
        <div className="bc-grid">
          <section className="bc-card">
            <label className="bc-label" htmlFor="bc-session">
              {t('broadcast.session')}
            </label>
            <select
              id="bc-session"
              className="bc-input"
              value={sessionId}
              disabled={running}
              onChange={e => setChosen(e.target.value)}
            >
              {readySessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>

            <div className="bc-row-head">
              <span className="bc-label">
                {t('broadcast.groups')} ({selected.size}/{groups.length})
              </span>
              <button className="btn-secondary" type="button" disabled={running} onClick={() => void refetch()}>
                {t('broadcast.reload')}
              </button>
            </div>
            <div className="bc-search">
              <Search size={14} />
              <input
                className="bc-input"
                placeholder={t('broadcast.search')}
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
            <label className="bc-check bc-check--all">
              <input type="checkbox" checked={allVisibleSelected} disabled={running} onChange={toggleAllVisible} />
              {t('broadcast.selectAll')}
            </label>
            <p className="bc-muted">{t('broadcast.maxGroups', { n: MAX_GROUPS })}</p>
            <div className="bc-list" role="group" aria-label={t('broadcast.groups')}>
              {loadingGroups && <div className="bc-muted">{t('broadcast.loading')}</div>}
              {groupsError && <div className="bc-error">{t('broadcast.loadFailed')}</div>}
              {!loadingGroups && !groupsError && visible.length === 0 && (
                <div className="bc-muted">{t('broadcast.noGroups')}</div>
              )}
              {visible.map(g => (
                <label key={g.id} className="bc-check">
                  <input
                    type="checkbox"
                    checked={selected.has(g.id)}
                    disabled={running}
                    onChange={() => toggle(g.id)}
                  />
                  <span>{g.name ?? g.id}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="bc-card">
            <label className="bc-label" htmlFor="bc-text">
              {t('broadcast.message')}
            </label>
            <textarea
              id="bc-text"
              className="bc-input bc-textarea"
              rows={8}
              value={text}
              disabled={running}
              placeholder={t('broadcast.messagePlaceholder')}
              onChange={e => setText(e.target.value)}
            />

            <label className="bc-label" htmlFor="bc-delay">
              {t('broadcast.delay')}
            </label>
            <select
              id="bc-delay"
              className="bc-input"
              value={delay}
              disabled={running}
              onChange={e => setDelay(Number(e.target.value))}
            >
              {DELAYS_SECONDS.map(s => (
                <option key={s} value={s}>
                  {t('broadcast.delaySeconds', { n: s })}
                </option>
              ))}
            </select>
            <p className="bc-muted">{t('broadcast.warning')}</p>
            <p className="bc-muted">{t('broadcast.background')}</p>

            <div className="bc-actions">
              <button className="btn-primary" type="button" disabled={!canSend} onClick={() => void handleSend()}>
                {running || submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {t('broadcast.send', { n: selected.size })}
              </button>
              {running && canWrite && (
                <button className="btn-secondary" type="button" disabled={stopping} onClick={() => void handleStop()}>
                  <Square size={14} /> {t('broadcast.stop')}
                </button>
              )}
              {active && !running && (
                <button className="btn-secondary" type="button" onClick={handleClear}>
                  {t('broadcast.clear')}
                </button>
              )}
            </div>

            {rows.length > 0 && (
              <div className="bc-results" aria-live="polite">
                <div className="bc-label">
                  <Megaphone size={14} />{' '}
                  {t('broadcast.results', { sent: sentCount, failed: failedCount, total: rows.length })}
                </div>
                <ul>
                  {rows.map(r => (
                    <li key={r.id} className={`bc-res bc-res--${r.status}`}>
                      {r.status === 'sent' && <CheckCircle2 size={14} />}
                      {r.status === 'failed' && <XCircle size={14} />}
                      {r.status === 'pending' &&
                        (running ? <Loader2 size={14} className="animate-spin" /> : <Clock size={14} />)}
                      <span>{r.name}</span>
                      {r.error && <small>{r.error}</small>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
