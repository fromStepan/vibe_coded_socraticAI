export type Role = 'admin' | 'student';
export type Stage = 'understand' | 'plan' | 'solve' | 'reflect';
export type MessageType =
  | 'question' | 'guiding_question' | 'hint' | 'correct' | 'wrong_answer' | 'fallback'
  | 'student_response' | 'hint_request' | 'know_answer';

export type User = { id: string; username: string; displayName: string; role: Role; grade: string };

export type Feedback = { rating: 1 | -1; comment: string };

export type GuardAttempt = { attempt: number; draft: string; leaked: boolean; method: string; reason: string };

export type Message = {
  id: string;
  sender: 'tutor' | 'student';
  text: string;
  type: MessageType;
  stage: Stage;
  createdAt: string;
  feedback?: Feedback | null;
  guard?: GuardAttempt[];
  allFeedback?: (Feedback & { by: string })[];
};

export type ConversationSummary = {
  id: string;
  problem: string;
  topic: string;
  grade: string;
  stage: Stage;
  completed: boolean;
  hintsUsed: number;
  wrongAttempts: number;
  outOfScope: boolean;
  fromTextbook: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AdminConversationSummary = ConversationSummary & {
  userId: string;
  studentName: string;
  username: string;
  leaksCaught: number;
  fallbacks: number;
  thumbsDown: number;
  thumbsUp: number;
};

export type ConversationDetail = (ConversationSummary & Partial<AdminConversationSummary>) & {
  isOwner: boolean;
  messages: Message[];
  debug?: {
    correctAnswer: string;
    answerSource: string;
    chapterFiles: string[];
    groundingLabels: string[];
    routeReason: string;
    exerciseId: number | null;
  };
};

export type TurnResult = {
  messages: Message[];
  stage: Stage;
  completed: boolean;
  hintsUsed: number;
  correct: boolean | null;
};

export type Exercise = { id: number; chapter: number; topic: string; lesson: string; text: string };

export type AdminUser = User & { createdAt: string; chats: number; solved: number; lastActive: string | null };

export type FeedbackItem = {
  id: number;
  rating: 1 | -1;
  comment: string;
  createdAt: string;
  by: string;
  conversationId: string;
  messageId: string;
  problem: string;
  topic: string;
  tutorText: string;
  tutorType: MessageType;
  studentText: string | null;
};

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const data = await res.json();
      if (typeof data.detail === 'string') detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d: { msg: string }) => d.msg).join('; ');
    } catch { /* non-JSON error body */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

export const api = {
  authConfig: () => get<{ allowSignup: boolean; grades: string[]; tts: boolean }>('/api/auth/config'),
  me: () => get<User>('/api/auth/me'),
  login: (username: string, password: string) => post<User>('/api/auth/login', { username, password }),
  register: (data: { username: string; password: string; displayName: string; grade: string }) =>
    post<User>('/api/auth/register', data),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  updateMe: (data: { displayName?: string; grade?: string; currentPassword?: string; newPassword?: string }) =>
    patch<User>('/api/auth/me', data),

  exercises: (grade?: string) => get<Exercise[]>(`/api/exercises${grade ? `?grade=${grade}` : ''}`),
  conversations: () => get<ConversationSummary[]>('/api/conversations'),
  conversation: (id: string) => get<ConversationDetail>(`/api/conversations/${id}`),
  start: (data: { problem?: string; exerciseId?: number; grade?: string }) => post<{ id: string }>('/api/conversations', data),
  chat: (id: string, text: string) => post<TurnResult>(`/api/conversations/${id}/chat`, { text }),
  hint: (id: string) => post<TurnResult>(`/api/conversations/${id}/hint`),
  answer: (id: string, answer: string) => post<TurnResult>(`/api/conversations/${id}/answer`, { answer }),
  deleteConversation: (id: string) => del<{ ok: boolean }>(`/api/conversations/${id}`),

  giveFeedback: (messageId: string, rating: 1 | -1, comment = '') =>
    post<Feedback>(`/api/messages/${messageId}/feedback`, { rating, comment }),
  removeFeedback: (messageId: string) => del<{ ok: boolean }>(`/api/messages/${messageId}/feedback`),

  admin: {
    conversations: () => get<AdminConversationSummary[]>('/api/admin/conversations'),
    users: () => get<AdminUser[]>('/api/admin/users'),
    createUser: (data: { username: string; password: string; displayName: string; grade: string; role: Role }) =>
      post<User>('/api/admin/users', data),
    resetPassword: (id: string, password: string) => post<{ ok: boolean }>(`/api/admin/users/${id}/password`, { password }),
    deleteUser: (id: string) => del<{ ok: boolean }>(`/api/admin/users/${id}`),
    feedback: () => get<FeedbackItem[]>('/api/admin/feedback'),
  },
};
