import { TopicKey, isTopicKey } from '@/lib/topicConfig';

const STORAGE_KEY = 'tt-onboarding-v1';

export interface OnboardingState {
  /** Epoch ms when the visitor finished or skipped the welcome flow. */
  completedAt: number | null;
  lastTopic: TopicKey | null;
  lastTechnologyId: string | null;
}

export const EMPTY_ONBOARDING_STATE: OnboardingState = {
  completedAt: null,
  lastTopic: null,
  lastTechnologyId: null,
};

/**
 * Reads the persisted onboarding state. Every access is guarded because
 * localStorage is missing during server rendering and throws in some
 * private-browsing modes.
 */
export function readOnboardingState(): OnboardingState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_ONBOARDING_STATE;

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return EMPTY_ONBOARDING_STATE;
    const record = parsed as Record<string, unknown>;

    return {
      completedAt:
        typeof record.completedAt === 'number' ? record.completedAt : null,
      lastTopic: isTopicKey(record.lastTopic) ? record.lastTopic : null,
      lastTechnologyId:
        typeof record.lastTechnologyId === 'string'
          ? record.lastTechnologyId
          : null,
    };
  } catch {
    return EMPTY_ONBOARDING_STATE;
  }
}

export function writeOnboardingState(
  patch: Partial<OnboardingState>,
): OnboardingState {
  const next = { ...readOnboardingState(), ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable: the flow still works, it just is not remembered.
  }
  return next;
}
