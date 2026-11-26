import { useSyncExternalStore } from 'react';

// Per-browser operator settings: the name stamped on replies and the status tags put on chats.
// Kept in localStorage on purpose (no server tables), so they belong to this browser only.

export interface ChatTag {
  id: string;
  name: string;
  /** CSS colour, #rrggbb. */
  color: string;
}

export interface OperatorSettings {
  username: string;
  tags: ChatTag[];
  /** chatId -> tag id. */
  assignments: Record<string, string>;
}

export const DEFAULT_TAGS: ChatTag[] = [
  { id: 'pending', name: 'Pending', color: '#f59e0b' },
  { id: 'in-progress', name: 'In progress', color: '#3b82f6' },
  { id: 'waiting-approval', name: 'Waiting for approval', color: '#8b5cf6' },
  { id: 'completed', name: 'Completed', color: '#16a34a' },
];

const STORAGE_KEY = 'operator-settings';
export const USERNAME_MAX = 40;
export const TAG_NAME_MAX = 30;
export const TAGS_MAX = 12;

const HEX = /^#[0-9a-fA-F]{6}$/;

function defaults(): OperatorSettings {
  return { username: '', tags: DEFAULT_TAGS.map(t => ({ ...t })), assignments: {} };
}

/** Reads whatever is stored, keeping only well-formed parts, so a hand-edited or old value cannot break the page. */
export function parseSettings(raw: string | null): OperatorSettings {
  const base = defaults();
  if (!raw) return base;
  try {
    const v = JSON.parse(raw) as Partial<OperatorSettings>;
    const username = typeof v.username === 'string' ? v.username.slice(0, USERNAME_MAX) : '';
    const tags = Array.isArray(v.tags)
      ? v.tags
          .filter(
            (t): t is ChatTag =>
              !!t &&
              typeof t.id === 'string' &&
              typeof t.name === 'string' &&
              typeof t.color === 'string' &&
              HEX.test(t.color),
          )
          .slice(0, TAGS_MAX)
      : base.tags;
    const assignments: Record<string, string> = {};
    if (v.assignments && typeof v.assignments === 'object') {
      for (const [chatId, tagId] of Object.entries(v.assignments)) {
        if (typeof tagId === 'string' && tags.some(t => t.id === tagId)) assignments[chatId] = tagId;
      }
    }
    return { username, tags, assignments };
  } catch {
    return base;
  }
}

let cache: OperatorSettings | null = null;
const listeners = new Set<() => void>();

function read(): OperatorSettings {
  if (cache) return cache;
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: defaults apply for this page load */
  }
  cache = parseSettings(raw);
  return cache;
}

function write(next: OperatorSettings) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable or full: the change lives until the page is closed */
  }
  listeners.forEach(l => l());
}

// Another tab changed it: drop the cache and redraw.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) {
      cache = null;
      listeners.forEach(l => l());
    }
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOperatorSettings(): OperatorSettings {
  return read();
}

export function useOperatorSettings(): OperatorSettings {
  return useSyncExternalStore(subscribe, read, read);
}

/** The server owns the name (it is locked once set); this keeps the copy the reply prefix reads in step with it. */
export function syncUsername(username: string | null) {
  const next = (username ?? '').trim().slice(0, USERNAME_MAX);
  if (read().username !== next) write({ ...read(), username: next });
}

export function setTags(tags: ChatTag[]) {
  const cur = read();
  const kept = tags.slice(0, TAGS_MAX);
  const assignments: Record<string, string> = {};
  for (const [chatId, tagId] of Object.entries(cur.assignments)) {
    if (kept.some(t => t.id === tagId)) assignments[chatId] = tagId;
  }
  write({ ...cur, tags: kept, assignments });
}

export function resetTags() {
  setTags(DEFAULT_TAGS.map(t => ({ ...t })));
}

/** Puts a tag on a chat, or takes it off with null. */
export function setChatTag(chatId: string, tagId: string | null) {
  const cur = read();
  const assignments = { ...cur.assignments };
  if (tagId && cur.tags.some(t => t.id === tagId)) assignments[chatId] = tagId;
  else delete assignments[chatId];
  write({ ...cur, assignments });
}

export function newTagId(): string {
  return `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/** The text a reply goes out with: the operator's name in bold ahead of it. An empty name or text changes nothing. */
export function prefixWithUsername(text: string, username = read().username): string {
  const name = username.trim();
  if (!name || !text) return text;
  return `*${name.replace(/\*/g, '')}:* ${text}`;
}

/** Black or white, whichever reads better on the colour. */
export function readableTextColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#111827' : '#ffffff';
}
