// Структура данных карты и проверки входящих значений (PRD, раздел 5).
// Четыре уровня: Roadmap → Stage → Task → Subtask. Глубже не идём.
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

export const STATUSES = ['todo', 'in_progress', 'blocked', 'done'];
export const NOTE_AUTHORS = ['human', 'agent'];

/** Короткий читаемый id с префиксом уровня: rm_3f9a21c4 */
export function newId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
}

export const nowIso = () => new Date().toISOString();

const trimmed = (max) => z.string().trim().min(1).max(max);

// --- входящие данные (что присылает клиент или MCP) ---

export const RoadmapInput = z.object({
  title: trimmed(200),
  goal: z.string().trim().max(2000).default(''),
  context: z.string().trim().max(20000).default(''),
});

export const RoadmapPatch = z
  .object({
    title: trimmed(200).optional(),
    goal: z.string().trim().max(2000).optional(),
    context: z.string().trim().max(20000).optional(),
    archived: z.boolean().optional(),
  })
  .strict();

export const StageInput = z.object({
  title: trimmed(200),
  order: z.number().int().min(0).optional(),
  dependsOn: z.array(z.string()).max(50).default([]),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'цвет в формате #rrggbb')
    .optional(),
});

export const StagePatch = StageInput.partial().strict();

export const TaskInput = z.object({
  stageId: trimmed(60),
  title: trimmed(300),
  description: z.string().max(20000).default(''),
  status: z.enum(STATUSES).default('todo'),
  acceptance: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  files: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  dependsOn: z.array(z.string()).max(50).default([]),
  estimate: z.number().min(0).max(1000).nullable().default(null),
  // x/y сознательно не принимаются от агента — PRD, раздел 7, правило 1.
});

export const TaskPatch = z
  .object({
    title: trimmed(300).optional(),
    description: z.string().max(20000).optional(),
    acceptance: z.array(z.string().trim().min(1).max(500)).max(50).optional(),
    files: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    estimate: z.number().min(0).max(1000).nullable().optional(),
    stageId: trimmed(60).optional(),
    version: z.number().int().min(1).optional(), // защита от одновременной правки
  })
  .strict();

/** Позиции на канвасе ставит раскладка или пользователь — отдельной ручкой, не через update_task. */
export const PositionInput = z.object({
  x: z.number(),
  y: z.number(),
});

export const TemplateInput = z.object({
  templateId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  goal: z.string().max(2000).optional(),
  context: z.string().max(20000).optional(),
});

// Раскладка целиком: канвас сохраняет её одной записью, а не по ноде за раз.
export const PositionsInput = z.object({
  positions: z
    .array(z.object({ id: z.string(), x: z.number(), y: z.number() }))
    .min(1, 'список координат пуст')
    .max(400, 'за один раз можно сохранить не больше 400 координат'),
});

export const StatusInput = z
  .object({
    status: z.enum(STATUSES),
    reason: z.string().trim().max(1000).optional(),
    version: z.number().int().min(1).optional(),
  })
  .strict()
  .refine((v) => v.status !== 'blocked' || (v.reason && v.reason.length > 0), {
    message: 'для статуса blocked обязательна причина (reason)',
    path: ['reason'],
  });

export const SubtaskInput = z.object({
  title: trimmed(300),
  done: z.boolean().default(false),
  order: z.number().int().min(0).optional(),
});

export const NoteInput = z.object({
  text: trimmed(5000),
  author: z.enum(NOTE_AUTHORS).default('agent'),
});

export const LinkInput = z.object({
  dependsOn: trimmed(60),
});

// --- bulk: целое дерево за один вызов (PRD, раздел 13: потолок 40 задач) ---

export const BULK_TASK_LIMIT = 40;

export const BulkInput = z.object({
  stages: z
    .array(
      z.object({
        title: trimmed(200),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        tasks: z
          .array(
            z.object({
              title: trimmed(300),
              description: z.string().max(20000).default(''),
              status: z.enum(STATUSES).default('todo'),
              acceptance: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
              files: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
              estimate: z.number().min(0).max(1000).nullable().default(null),
              subtasks: z.array(z.string().trim().min(1).max(300)).max(40).default([]),
            }),
          )
          .default([]),
      }),
    )
    .min(1)
    .max(20),
});

// --- форма файла карты на диске ---

export const RoadmapFile = z.object({
  schemaVersion: z.literal(1),
  roadmap: z.object({
    id: z.string(),
    title: z.string(),
    goal: z.string(),
    context: z.string(),
    archived: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
  stages: z.array(
    z.object({
      id: z.string(),
      roadmapId: z.string(),
      title: z.string(),
      order: z.number(),
      dependsOn: z.array(z.string()),
      color: z.string().nullable(),
    }),
  ),
  tasks: z.array(
    z.object({
      id: z.string(),
      stageId: z.string(),
      title: z.string(),
      description: z.string(),
      status: z.enum(STATUSES),
      acceptance: z.array(z.string()),
      files: z.array(z.string()),
      dependsOn: z.array(z.string()),
      estimate: z.number().nullable(),
      x: z.number(),
      y: z.number(),
      version: z.number().int().min(1),
      createdAt: z.string(),
      updatedAt: z.string(),
      notes: z.array(
        z.object({
          id: z.string(),
          text: z.string(),
          author: z.enum(NOTE_AUTHORS),
          createdAt: z.string(),
        }),
      ),
      subtasks: z.array(
        z.object({
          id: z.string(),
          taskId: z.string(),
          title: z.string(),
          done: z.boolean(),
          order: z.number(),
        }),
      ),
    }),
  ),
});

export function emptyRoadmapFile(input) {
  const ts = nowIso();
  return {
    schemaVersion: 1,
    roadmap: {
      id: newId('rm'),
      title: input.title,
      goal: input.goal,
      context: input.context,
      archived: false,
      createdAt: ts,
      updatedAt: ts,
    },
    stages: [],
    tasks: [],
  };
}
