import { useEffect, useState } from 'react';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../components/PageHeader';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useToast } from '../hooks/useToast';
import {
  TAGS_MAX,
  TAG_NAME_MAX,
  USERNAME_MAX,
  newTagId,
  prefixWithUsername,
  resetTags,
  setTags,
  setUsername,
  useOperatorSettings,
} from '../utils/operatorSettings';
import './Settings.css';

export function Settings() {
  const { t } = useTranslation();
  useDocumentTitle(t('nav.settings'));
  const toast = useToast();
  const settings = useOperatorSettings();
  const [name, setName] = useState(settings.username);

  // Another tab saved a different name.
  useEffect(() => setName(settings.username), [settings.username]);

  const saveName = () => {
    setUsername(name);
    toast.success(t('settings.saved'));
  };

  const updateTag = (id: string, patch: { name?: string; color?: string }) =>
    setTags(settings.tags.map(tag => (tag.id === id ? { ...tag, ...patch } : tag)));

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
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') saveName();
            }}
          />
          <button className="btn-primary" type="button" onClick={saveName}>
            {t('settings.save')}
          </button>
        </div>
        <p className="os-muted">
          {t('settings.preview')}: <strong>{prefixWithUsername(t('settings.previewText'), name) || '—'}</strong>
        </p>
      </section>

      <section className="os-card">
        <h2>{t('settings.tagsTitle')}</h2>
        <p className="os-muted">{t('settings.tagsHelp')}</p>
        <ul className="os-tags">
          {settings.tags.map(tag => (
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
                onClick={() => setTags(settings.tags.filter(x => x.id !== tag.id))}
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
            disabled={settings.tags.length >= TAGS_MAX}
            onClick={() =>
              setTags([...settings.tags, { id: newTagId(), name: t('settings.newTag'), color: '#64748b' }])
            }
          >
            <Plus size={14} /> {t('settings.addTag')}
          </button>
          <button className="btn-secondary" type="button" onClick={resetTags}>
            <RotateCcw size={14} /> {t('settings.resetTags')}
          </button>
        </div>
        <p className="os-muted">{t('settings.browserOnly')}</p>
      </section>
    </div>
  );
}
