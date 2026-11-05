// Весь обмен с сервером. Заголовок x-tropa-source: human говорит серверу, что правка
// пришла из браузера, — по нему вкладка потом отличает свои изменения от правок агента.
import type { RoadmapSummary, RoadmapView, Status, TaskFull } from './types';

export class ApiError extends Error {
  status: number;
  currentVersion?: number;
  constructor(status: number, message: string, currentVersion?: number) {
    super(message);
    this.status = status;
    this.currentVersion = currentVersion;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: {
      'x-tropa-source': 'human',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const issues = (json.issues ?? []).map((i: { field: string; message: string }) => `${i.field}: ${i.message}`);
    throw new ApiError(res.status, [json.error, ...issues].filter(Boolean).join('; '), json.currentVersion);
  }
  return json as T;
}

export const listRoadmaps = () => request<{ roadmaps: RoadmapSummary[] }>('GET', '/roadmaps');
export const getRoadmap = (id: string) => request<RoadmapView>('GET', `/roadmaps/${id}`);
export const getTask = (id: string, taskId: string) =>
  request<TaskFull>('GET', `/roadmaps/${id}/tasks/${taskId}`);

export const createRoadmap = (title: string) =>
  request<{ id: string }>('POST', '/roadmaps', { title, goal: '', context: '' });
export const updateRoadmap = (id: string, patch: Record<string, unknown>) =>
  request('PATCH', `/roadmaps/${id}`, patch);

export const createStage = (id: string, title: string) =>
  request<{ id: string }>('POST', `/roadmaps/${id}/stages`, { title });
export const updateStage = (id: string, stageId: string, patch: Record<string, unknown>) =>
  request('PATCH', `/roadmaps/${id}/stages/${stageId}`, patch);

export const createTask = (id: string, stageId: string, title: string) =>
  request<{ id: string }>('POST', `/roadmaps/${id}/tasks`, { stageId, title });
export const updateTask = (id: string, taskId: string, patch: Record<string, unknown>) =>
  request<TaskFull>('PATCH', `/roadmaps/${id}/tasks/${taskId}`, patch);
export const setStatus = (id: string, taskId: string, status: Status, reason?: string, version?: number) =>
  request<TaskFull>('POST', `/roadmaps/${id}/tasks/${taskId}/status`, { status, reason, version });
export const addNote = (id: string, taskId: string, text: string) =>
  request('POST', `/roadmaps/${id}/tasks/${taskId}/notes`, { text, author: 'human' });

/** Координаты ноды — отдельная ручка, не обычная правка задачи (PRD, раздел 7). */
export const setPosition = (id: string, taskId: string, x: number, y: number) =>
  request('POST', `/roadmaps/${id}/tasks/${taskId}/position`, { x, y });
export const setPositions = (id: string, positions: { id: string; x: number; y: number }[]) =>
  request('POST', `/roadmaps/${id}/positions`, { positions });

export const linkTasks = (id: string, taskId: string, dependsOn: string) =>
  request('POST', `/roadmaps/${id}/tasks/${taskId}/links`, { dependsOn });
export const unlinkTasks = (id: string, taskId: string, dependsOn: string) =>
  request('DELETE', `/roadmaps/${id}/tasks/${taskId}/links/${dependsOn}`);

export const deleteNote = (id: string, taskId: string, noteId: string) =>
  request('DELETE', `/roadmaps/${id}/tasks/${taskId}/notes/${noteId}?confirm=true`);

export const createSubtask = (id: string, taskId: string, title: string) =>
  request('POST', `/roadmaps/${id}/tasks/${taskId}/subtasks`, { title });
export const toggleSubtask = (id: string, taskId: string, subtaskId: string, done: boolean) =>
  request('PATCH', `/roadmaps/${id}/tasks/${taskId}/subtasks/${subtaskId}`, { done });
export const deleteSubtask = (id: string, taskId: string, subtaskId: string) =>
  request('DELETE', `/roadmaps/${id}/tasks/${taskId}/subtasks/${subtaskId}?confirm=true`);

export interface TemplateBrief {
  id: string;
  title: string;
  about: string;
  goal: string;
  stages: number;
  tasks: number;
}

export const listTemplates = () => request<{ templates: TemplateBrief[] }>('GET', '/templates');
export const createFromTemplate = (templateId: string, title: string) =>
  request<{ id: string }>('POST', '/roadmaps/from-template', { templateId, title });
export const exportMarkdown = (id: string) =>
  request<{ markdown: string; title: string }>('GET', `/roadmaps/${id}/export`);
export const taskPrompt = (id: string, taskId: string) =>
  request<{ prompt: string }>('GET', `/roadmaps/${id}/tasks/${taskId}/prompt`);
