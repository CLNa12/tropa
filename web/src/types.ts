// Формы данных ровно такие, какие отдаёт API этапа 1 (см. server/schema.js).
export type Status = 'todo' | 'in_progress' | 'blocked' | 'done';
export type Author = 'human' | 'agent';

export interface Progress {
  done: number;
  total: number;
}

export interface RoadmapSummary {
  id: string;
  title: string;
  goal: string;
  archived: boolean;
  updatedAt: string;
  progress: Progress;
}

export interface Stage {
  id: string;
  roadmapId: string;
  title: string;
  order: number;
  dependsOn: string[];
  color: string | null;
  progress: Progress;
}

/** Компактная задача из get_roadmap: без описаний и заметок (PRD, раздел 7, правило 2). */
export interface TaskBrief {
  id: string;
  stageId: string;
  title: string;
  status: Status;
  dependsOn: string[];
  subtasks: Progress;
  version: number;
}

export interface RoadmapView {
  roadmap: {
    id: string;
    title: string;
    goal: string;
    context: string;
    archived: boolean;
    createdAt: string;
    updatedAt: string;
  };
  stages: Stage[];
  tasks: TaskBrief[];
}

export interface Note {
  id: string;
  text: string;
  author: Author;
  createdAt: string;
}

export interface Subtask {
  id: string;
  taskId: string;
  title: string;
  done: boolean;
  order: number;
}

/** Полная задача из get_task: со всем, чего нет в компактном виде. */
export interface TaskFull {
  id: string;
  stageId: string;
  title: string;
  description: string;
  status: Status;
  acceptance: string[];
  files: string[];
  dependsOn: string[];
  estimate: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  notes: Note[];
  subtasks: Subtask[];
  stage: Omit<Stage, 'progress'> | null;
  blockedBy: string[];
  blocks: string[];
}

export interface ChangeEvent {
  type: 'roadmap' | 'deleted';
  roadmapId: string;
  source: Author;
  at: string;
}

export const STATUS_LABELS: Record<Status, string> = {
  todo: 'не начата',
  in_progress: 'в работе',
  blocked: 'заблокирована',
  done: 'готова',
};
