import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { api } from './api';

export const SPEEDS = [0.75, 1, 1.25] as const;
export type Speed = (typeof SPEEDS)[number];

type VoiceState = {
  enabled: boolean;
  currentId: string | null;
  status: 'idle' | 'loading' | 'playing';
  speed: Speed;
  autoRead: boolean;
};

const stored = (key: string) => localStorage.getItem(`voice.${key}`);

let state: VoiceState = {
  enabled: false,
  currentId: null,
  status: 'idle',
  speed: (SPEEDS as readonly number[]).includes(Number(stored('speed'))) ? (Number(stored('speed')) as Speed) : 1,
  autoRead: stored('autoRead') === 'true',
};

const listeners = new Set<() => void>();
const audio = new Audio();
audio.preload = 'auto';

function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

api.authConfig().then((c) => set({ enabled: c.tts })).catch(() => undefined);

audio.addEventListener('playing', () => set({ status: 'playing' }));
audio.addEventListener('waiting', () => set({ status: 'loading' }));
audio.addEventListener('ended', () => set({ currentId: null, status: 'idle' }));
audio.addEventListener('error', () => {
  if (state.currentId) toast.error('Չհաջողվեց միացնել ձայնը, փորձիր նորից');
  set({ currentId: null, status: 'idle' });
});

export function play(messageId: string) {
  audio.pause();
  audio.src = `/api/messages/${messageId}/audio`;
  audio.playbackRate = state.speed;
  set({ currentId: messageId, status: 'loading' });
  audio.play().catch(() => {
    // Browsers block sound until the page has been clicked once; auto-read just stays silent then.
    set({ currentId: null, status: 'idle' });
  });
}

export function stop() {
  audio.pause();
  set({ currentId: null, status: 'idle' });
}

export function toggle(messageId: string) {
  if (state.currentId === messageId) stop();
  else play(messageId);
}

export function setSpeed(speed: Speed) {
  localStorage.setItem('voice.speed', String(speed));
  audio.playbackRate = speed;
  set({ speed });
}

export function setAutoRead(autoRead: boolean) {
  localStorage.setItem('voice.autoRead', String(autoRead));
  if (!autoRead) stop();
  set({ autoRead });
}

export function useVoice(): VoiceState {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => state,
  );
}
