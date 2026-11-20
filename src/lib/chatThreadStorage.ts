import { ChatHistory, ChatKgSettings, ChatMessage } from '@/lib/types';
import {
  CHAT_THREAD_INDEX_KEY,
  chatHistoryStorageKey,
  chatScrollStorageKey,
  dropFromThreadIndex,
  parseThreadIndex,
  touchThreadIndex,
} from '@/lib/chatContext';

/*
 * Chat conversations in localStorage, one per thread key (see
 * chatContext.ts). Every access is guarded: storage can be missing or full.
 */

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export const KG_SETTINGS_KEY = 'tech-tree-chat-kg-settings-v1';

/** Server-side defaults: 10/25 match MAX_TOOL_ROUNDS(_THINKING) on the
 * kg-service, 180s matches KG_TIMEOUT_MS in the chat route. */
export const DEFAULT_KG_SETTINGS: ChatKgSettings = {
  reasoning: true,
  showLookups: true,
  timeoutSec: 180,
  instantLimit: 10,
  thinkingLimit: 25,
};

/** Stored KG settings, or null when the user has never saved them. */
export function loadKgSettings(): ChatKgSettings | null {
  try {
    const raw = storage()?.getItem(KG_SETTINGS_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as ChatKgSettings & { lookups?: boolean };
    return {
      ...DEFAULT_KG_SETTINGS,
      ...stored,
      // `lookups` used to gate tool use; it now only controls the display.
      showLookups: stored.showLookups ?? stored.lookups ?? DEFAULT_KG_SETTINGS.showLookups,
    };
  } catch {
    return null;
  }
}

export function saveKgSettings(settings: ChatKgSettings): void {
  try {
    storage()?.setItem(KG_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // A convenience — losing them just means defaults next time.
  }
}

export function loadThread(threadKey: string): ChatMessage[] {
  try {
    const raw = storage()?.getItem(chatHistoryStorageKey(threadKey));
    if (!raw) return [];
    const history = JSON.parse(raw) as ChatHistory;
    return Array.isArray(history?.messages) ? history.messages : [];
  } catch {
    return [];
  }
}

/** Saves a thread and marks it recently used, evicting the oldest. */
export function saveThread(threadKey: string, messages: ChatMessage[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (!messages.length) {
      store.removeItem(chatHistoryStorageKey(threadKey));
      return;
    }
    const history: ChatHistory = { messages, lastUpdated: Date.now() };
    store.setItem(chatHistoryStorageKey(threadKey), JSON.stringify(history));
    const { index, evicted } = touchThreadIndex(
      parseThreadIndex(store.getItem(CHAT_THREAD_INDEX_KEY)),
      threadKey,
      Date.now(),
    );
    store.setItem(CHAT_THREAD_INDEX_KEY, JSON.stringify(index));
    for (const key of evicted) {
      store.removeItem(chatHistoryStorageKey(key));
      store.removeItem(chatScrollStorageKey(key));
    }
  } catch (error) {
    console.error('Error saving chat history:', error);
  }
}

export function deleteThread(threadKey: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(chatHistoryStorageKey(threadKey));
    store.removeItem(chatScrollStorageKey(threadKey));
    store.setItem(
      CHAT_THREAD_INDEX_KEY,
      JSON.stringify(
        dropFromThreadIndex(parseThreadIndex(store.getItem(CHAT_THREAD_INDEX_KEY)), threadKey),
      ),
    );
  } catch {
    // Nothing to clean up.
  }
}

/** Carries a conversation over, e.g. from a draft to the tree it became. */
export function moveThread(fromKey: string, toKey: string): void {
  if (fromKey === toKey) return;
  const messages = loadThread(fromKey);
  if (!messages.length) return;
  saveThread(toKey, [...loadThread(toKey), ...messages]);
  deleteThread(fromKey);
}

export function loadScroll(threadKey: string): number | null {
  try {
    const raw = storage()?.getItem(chatScrollStorageKey(threadKey));
    return raw ? Number.parseInt(raw, 10) : null;
  } catch {
    return null;
  }
}

export function saveScroll(threadKey: string, top: number): void {
  try {
    storage()?.setItem(chatScrollStorageKey(threadKey), String(top));
  } catch {
    // Scroll position is a convenience.
  }
}
