// Центральная зона: дерево «этап → задача → подзадачи».
// Подзадачи подтягиваются только для раскрытых задач — компактность ответов не нарушается.
import type { Stage, Status, TaskBrief, TaskFull } from '../types';
import { ProgressRing } from './ProgressRing';

interface Props {
  stages: Stage[];
  tasks: TaskBrief[];
  details: Record<string, TaskFull>;
  expanded: Set<string>;
  flash: Set<string>;
  selectedId: string | null;
  onSelect: (taskId: string) => void;
  onToggleExpand: (taskId: string) => void;
  onToggleSubtask: (taskId: string, subtaskId: string, done: boolean) => void;
  onCreateTask: (stageId: string) => void;
  registerStage: (stageId: string, el: HTMLDivElement | null) => void;
}

const statusColor = (status: Status) => `var(--${status})`;

export function TaskTree(props: Props) {
  if (props.stages.length === 0) {
    return (
      <div className="empty-state">
        В этой карте пока нет этапов.
        <br />
        Добавьте первый кнопкой «+» в сайдбаре — или попросите Claude построить карту по вашей цели.
      </div>
    );
  }

  return (
    <div className="tree">
      {props.stages.map((stage) => {
        const tasks = props.tasks.filter((t) => t.stageId === stage.id);
        return (
          <div className="stage-block" key={stage.id} ref={(el) => props.registerStage(stage.id, el)}>
            <div className="stage-head">
              <ProgressRing
                done={stage.progress.done}
                total={stage.progress.total}
                size={14}
                color={stage.color ?? '#7c6cf0'}
              />
              <span className="title">{stage.title}</span>
              <span className="count">
                {stage.progress.done}/{stage.progress.total}
              </span>
              <span className="spacer" />
              <button className="btn" onClick={() => props.onCreateTask(stage.id)} title="Новая задача в этом этапе">
                + задача
              </button>
            </div>

            {tasks.length === 0 && (
              <div className="task-row" style={{ color: 'var(--muted-2)', cursor: 'default' }}>
                задач нет
              </div>
            )}

            {tasks.map((task) => {
              const full = props.details[task.id];
              const open = props.expanded.has(task.id);
              const blocked = task.dependsOn.filter(
                (id) => props.tasks.find((t) => t.id === id)?.status !== 'done',
              );
              return (
                <div key={task.id}>
                  <div
                    className={[
                      'task-row',
                      task.status === 'done' ? 'done' : '',
                      props.selectedId === task.id ? 'selected' : '',
                      props.flash.has(task.id) ? 'flash' : '',
                    ].join(' ')}
                    onClick={() => props.onSelect(task.id)}
                  >
                    <span className="dot" style={{ background: statusColor(task.status) }} />
                    <span className="title">{task.title}</span>
                    <span className="meta">
                      {blocked.length > 0 && <span className="chip blocked">блокируется {blocked.length}</span>}
                      {task.subtasks.total > 0 && (
                        <button
                          className="count"
                          onClick={(e) => {
                            e.stopPropagation();
                            props.onToggleExpand(task.id);
                          }}
                          title={open ? 'свернуть чеклист' : 'показать чеклист'}
                          style={{ color: 'inherit' }}
                        >
                          {open ? '▾' : '▸'} {task.subtasks.done}/{task.subtasks.total}
                        </button>
                      )}
                    </span>
                  </div>

                  {open && full && (
                    <div className="subtasks">
                      {full.subtasks.length === 0 && <div className="subtask">подзадач нет</div>}
                      {full.subtasks.map((s) => (
                        <label key={s.id} className={`subtask ${s.done ? 'done' : ''}`}>
                          <input
                            type="checkbox"
                            checked={s.done}
                            onChange={() => props.onToggleSubtask(task.id, s.id, !s.done)}
                          />
                          <span>{s.title}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
