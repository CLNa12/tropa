// Правая зона: задача целиком, с правкой по клику (PRD, раздел 8).
import { useEffect, useState } from 'react';
import type { Status, TaskBrief, TaskFull } from '../types';
import { STATUS_LABELS } from '../types';

interface Props {
  task: TaskFull;
  tasks: TaskBrief[];
  onClose: () => void;
  onPatch: (patch: Record<string, unknown>) => Promise<void>;
  onStatus: (status: Status, reason?: string) => Promise<void>;
  onAddNote: (text: string) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onAddSubtask: (title: string) => Promise<void>;
  onToggleSubtask: (subtaskId: string, done: boolean) => Promise<void>;
  onDeleteSubtask: (subtaskId: string) => Promise<void>;
  onJump: (taskId: string) => void;
}

const STATUSES: Status[] = ['todo', 'in_progress', 'blocked', 'done'];

/** Текст, который правится по клику: один клик — поле ввода, Esc — отмена. */
function Editable({
  value,
  placeholder,
  multiline,
  render,
  onSave,
}: {
  value: string;
  placeholder: string;
  multiline?: boolean;
  render?: (value: string) => React.ReactNode;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <div
        className={`editable ${value ? '' : 'empty'}`}
        onClick={() => setEditing(true)}
        title="нажмите, чтобы изменить"
      >
        {value ? (render ? render(value) : value) : placeholder}
      </div>
    );
  }

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft);
  };

  const common = {
    autoFocus: true,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setDraft(value);
        setEditing(false);
      }
      if (e.key === 'Enter' && (!multiline || e.ctrlKey)) {
        e.preventDefault();
        commit();
      }
    },
  };

  return multiline ? <textarea rows={6} {...common} /> : <input type="text" {...common} />;
}

/** Список строк правится как обычный текст: одна строка — один пункт. */
function EditableList({
  items,
  placeholder,
  mono,
  onSave,
}: {
  items: string[];
  placeholder: string;
  mono?: boolean;
  onSave: (next: string[]) => void;
}) {
  return (
    <Editable
      value={items.join('\n')}
      placeholder={placeholder}
      multiline
      render={(text) => (
        <ul className={`list ${mono ? 'files' : ''}`}>
          {text.split('\n').map((line, i) => (
            <li key={i}>{mono ? <code>{line}</code> : line}</li>
          ))}
        </ul>
      )}
      onSave={(text) =>
        onSave(
          text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
        )
      }
    />
  );
}

export function TaskPanel(props: Props) {
  const { task } = props;
  const [note, setNote] = useState('');
  const [subtask, setSubtask] = useState('');
  const [blockReason, setBlockReason] = useState<string | null>(null);

  useEffect(() => {
    setNote('');
    setSubtask('');
    setBlockReason(null);
  }, [task.id]);

  const titleOf = (id: string) => props.tasks.find((t) => t.id === id)?.title ?? id;
  const statusOf = (id: string) => props.tasks.find((t) => t.id === id)?.status ?? 'todo';

  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="task-title">
          <Editable
            value={task.title}
            placeholder="без заголовка"
            onSave={(title) => void props.onPatch({ title })}
          />
        </div>
        <button className="btn" onClick={props.onClose} title="закрыть панель">
          ✕
        </button>
      </div>

      <div className="panel-body">
        <div className="statuses">
          {STATUSES.map((s) => (
            <button
              key={s}
              className={task.status === s ? 'on' : ''}
              style={task.status === s ? { background: `var(--${s})` } : undefined}
              onClick={() => {
                if (s === 'blocked' && task.status !== 'blocked') setBlockReason('');
                else void props.onStatus(s);
              }}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>

        {blockReason !== null && (
          <div className="add-row">
            <input
              autoFocus
              value={blockReason}
              placeholder="чем именно заблокировано?"
              onChange={(e) => setBlockReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setBlockReason(null);
                if (e.key === 'Enter' && blockReason.trim()) {
                  void props.onStatus('blocked', blockReason.trim());
                  setBlockReason(null);
                }
              }}
            />
            <button
              className="btn primary"
              disabled={!blockReason.trim()}
              onClick={() => {
                void props.onStatus('blocked', blockReason.trim());
                setBlockReason(null);
              }}
            >
              Ок
            </button>
          </div>
        )}

        <h3>Описание</h3>
        <Editable
          value={task.description}
          placeholder="описания нет — нажмите, чтобы добавить"
          multiline
          onSave={(description) => void props.onPatch({ description })}
        />

        <h3>
          Чеклист {task.subtasks.length > 0 && `· ${task.subtasks.filter((s) => s.done).length}/${task.subtasks.length}`}
        </h3>
        {task.subtasks.length === 0 && <div className="editable empty">подзадач нет</div>}
        {task.subtasks.map((s) => (
          <div key={s.id} className={`subtask ${s.done ? 'done' : ''}`}>
            <input type="checkbox" checked={s.done} onChange={() => void props.onToggleSubtask(s.id, !s.done)} />
            <span style={{ flex: 1 }}>{s.title}</span>
            <button className="count" onClick={() => void props.onDeleteSubtask(s.id)} title="удалить подзадачу">
              ✕
            </button>
          </div>
        ))}
        <div className="add-row">
          <input
            value={subtask}
            placeholder="новая подзадача"
            onChange={(e) => setSubtask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && subtask.trim()) {
                void props.onAddSubtask(subtask.trim());
                setSubtask('');
              }
            }}
          />
        </div>

        <h3>Критерии приёмки</h3>
        <EditableList
          items={task.acceptance}
          placeholder="критериев нет — нажмите, чтобы добавить, по одному в строке"
          onSave={(acceptance) => void props.onPatch({ acceptance })}
        />

        <h3>Файлы</h3>
        <EditableList
          items={task.files}
          placeholder="файлов нет — по одному пути в строке"
          mono
          onSave={(files) => void props.onPatch({ files })}
        />

        <h3>Блокируется / блокирует</h3>
        <div className="links">
          {task.blockedBy.length === 0 && task.blocks.length === 0 && (
            <div className="editable empty">связей нет</div>
          )}
          {task.blockedBy.map((id) => (
            <div className="link-row" key={`b${id}`} onClick={() => props.onJump(id)}>
              <span className="chip blocked">ждёт</span>
              <span className="label">{titleOf(id)}</span>
            </div>
          ))}
          {task.blocks.map((id) => (
            <div className="link-row" key={`a${id}`} onClick={() => props.onJump(id)}>
              <span className="dot" style={{ background: `var(--${statusOf(id)})` }} />
              <span className="label">держит: {titleOf(id)}</span>
            </div>
          ))}
        </div>

        <h3>Заметки</h3>
        {task.notes.length === 0 && <div className="editable empty">заметок нет</div>}
        {task.notes.map((n) => (
          <div key={n.id} className={`note ${n.author}`}>
            <span className="who">
              {n.author === 'agent' ? 'Claude' : 'вы'} · {new Date(n.createdAt).toLocaleString('ru-RU')}
              <button className="count" onClick={() => void props.onDeleteNote(n.id)} title="удалить заметку">
                ✕
              </button>
            </span>
            {n.text}
          </div>
        ))}
        <div className="add-row">
          <input
            value={note}
            placeholder="что сделано или на чём застряли"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && note.trim()) {
                void props.onAddNote(note.trim());
                setNote('');
              }
            }}
          />
        </div>

        <h3>Служебное</h3>
        <div style={{ color: 'var(--muted-2)', fontSize: 11.5, lineHeight: 1.8 }}>
          id: {task.id}
          <br />
          версия: {task.version} · изменена {new Date(task.updatedAt).toLocaleString('ru-RU')}
          <br />
          оценка:{' '}
          <span style={{ display: 'inline-block', minWidth: 60 }}>
            <Editable
              value={task.estimate === null ? '' : String(task.estimate)}
              placeholder="не задана"
              onSave={(value) => {
                const trimmed = value.trim();
                const estimate = trimmed === '' ? null : Number(trimmed.replace(',', '.'));
                if (estimate !== null && Number.isNaN(estimate)) return;
                void props.onPatch({ estimate });
              }}
            />
          </span>
        </div>
      </div>
    </aside>
  );
}
