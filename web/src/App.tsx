// Один экран, три зоны (PRD, раздел 8). Вся связь с сервером — через api.ts,
// живое обновление — через поток событий /api/events.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { ApiError } from './api';
import { Sidebar, type StageFilter } from './components/Sidebar';
import { TaskPanel } from './components/TaskPanel';
import { TaskTree } from './components/TaskTree';
import type { ChangeEvent, RoadmapSummary, RoadmapView, Status, TaskBrief, TaskFull } from './types';

/** Что изменилось между двумя снимками карты — эти строки подсветим. */
function changedTasks(before: TaskBrief[], after: TaskBrief[]): string[] {
  const old = new Map(before.map((t) => [t.id, t]));
  return after
    .filter((t) => {
      const was = old.get(t.id);
      if (!was) return true;
      return (
        was.status !== t.status ||
        was.title !== t.title ||
        was.version !== t.version ||
        was.subtasks.done !== t.subtasks.done ||
        was.subtasks.total !== t.subtasks.total
      );
    })
    .map((t) => t.id);
}

export default function App() {
  const [roadmaps, setRoadmaps] = useState<RoadmapSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<RoadmapView | null>(null);
  const [details, setDetails] = useState<Record<string, TaskFull>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<StageFilter>('all');
  const [search, setSearch] = useState('');
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageRefs = useRef(new Map<string, HTMLDivElement>());
  const viewRef = useRef<RoadmapView | null>(null);
  const wanted = useRef<{ expanded: Set<string>; selected: string | null }>({
    expanded: new Set(),
    selected: null,
  });
  wanted.current = { expanded, selected: selectedId };

  const complain = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
    window.setTimeout(() => setError(null), 6000);
  }, []);

  const loadRoadmaps = useCallback(async () => {
    const { roadmaps: list } = await api.listRoadmaps();
    setRoadmaps(list);
    return list;
  }, []);

  /** Перечитать карту и подробности открытых задач; подсветить то, что изменилось. */
  const refresh = useCallback(
    async (id: string, highlight: boolean) => {
      const next = await api.getRoadmap(id);
      const previous = viewRef.current;
      viewRef.current = next;
      setView(next);

      if (highlight && previous && previous.roadmap.id === id) {
        const ids = changedTasks(previous.tasks, next.tasks);
        if (ids.length > 0) {
          setFlash(new Set(ids));
          window.setTimeout(() => setFlash(new Set()), 2100);
        }
      }

      const needed = new Set(wanted.current.expanded);
      if (wanted.current.selected) needed.add(wanted.current.selected);
      const alive = [...needed].filter((taskId) => next.tasks.some((t) => t.id === taskId));
      const loaded = await Promise.all(alive.map((taskId) => api.getTask(id, taskId).catch(() => null)));
      const fresh: Record<string, TaskFull> = {};
      for (const task of loaded) if (task) fresh[task.id] = task;
      setDetails(fresh);
      if (wanted.current.selected && !fresh[wanted.current.selected]) setSelectedId(null);
    },
    [],
  );

  // первая загрузка
  useEffect(() => {
    void (async () => {
      try {
        const list = await loadRoadmaps();
        const first = list.find((r) => !r.archived) ?? list[0];
        if (first) setActiveId(first.id);
      } catch (err) {
        complain(err);
      }
    })();
  }, [loadRoadmaps, complain]);

  // смена активной карты
  useEffect(() => {
    if (!activeId) return;
    setSelectedId(null);
    setExpanded(new Set());
    setDetails({});
    viewRef.current = null;
    void refresh(activeId, false).catch(complain);
  }, [activeId, refresh, complain]);

  // живое обновление: сервер сам присылает, что карта изменилась
  useEffect(() => {
    const source = new EventSource('/api/events');
    source.onopen = () => setLive(true);
    source.onerror = () => setLive(false);
    source.onmessage = (message) => {
      let event: ChangeEvent;
      try {
        event = JSON.parse(message.data);
      } catch {
        return;
      }
      void loadRoadmaps().catch(() => {});
      if (event.roadmapId && event.roadmapId === activeId) {
        // свои правки не подсвечиваем — подсвечиваем то, что сделал агент
        void refresh(event.roadmapId, event.source === 'agent').catch(complain);
      }
    };
    return () => source.close();
  }, [activeId, refresh, loadRoadmaps, complain]);

  const reload = useCallback(async () => {
    if (activeId) await refresh(activeId, false);
    await loadRoadmaps();
  }, [activeId, refresh, loadRoadmaps]);

  /** Любое действие пользователя: выполнить, перечитать, показать ошибку понятным текстом. */
  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      try {
        await fn();
        await reload();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          await reload();
          complain('Задачу успели изменить в другом месте — я перечитал её, попробуйте ещё раз.');
          return;
        }
        complain(err);
      }
    },
    [reload, complain],
  );

  const selectTask = useCallback(
    (taskId: string) => {
      setSelectedId(taskId);
      if (!activeId) return;
      setExpanded((prev) => new Set(prev).add(taskId));
      api
        .getTask(activeId, taskId)
        .then((task) => setDetails((prev) => ({ ...prev, [task.id]: task })))
        .catch(complain);
    },
    [activeId, complain],
  );

  const toggleExpand = useCallback(
    (taskId: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(taskId)) next.delete(taskId);
        else {
          next.add(taskId);
          if (activeId && !details[taskId]) {
            api
              .getTask(activeId, taskId)
              .then((task) => setDetails((cur) => ({ ...cur, [task.id]: task })))
              .catch(complain);
          }
        }
        return next;
      });
    },
    [activeId, details, complain],
  );

  const pickStage = useCallback((stageId: string) => {
    setActiveStageId(stageId);
    stageRefs.current.get(stageId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const selected = selectedId ? details[selectedId] : undefined;
  const stages = view ? view.stages : [];
  const totals = view
    ? { done: view.tasks.filter((t) => t.status === 'done').length, total: view.tasks.length }
    : { done: 0, total: 0 };

  return (
    <div className={`app ${selected ? 'with-panel' : ''}`}>
      <Sidebar
        roadmaps={roadmaps}
        activeId={activeId}
        stages={stages}
        activeStageId={activeStageId}
        search={search}
        filter={filter}
        live={live}
        storage="карты лежат в папке ~/.tropa"
        onSearch={setSearch}
        onFilter={setFilter}
        onPickRoadmap={setActiveId}
        onPickStage={pickStage}
        onCreateRoadmap={() => {
          const title = window.prompt('Название новой карты');
          if (title?.trim()) {
            void act(async () => {
              const created = await api.createRoadmap(title.trim());
              setActiveId(created.id);
            });
          }
        }}
        onCreateStage={() => {
          if (!activeId) return;
          const title = window.prompt('Название нового этапа');
          if (title?.trim()) void act(() => api.createStage(activeId, title.trim()));
        }}
      />

      <main className="main">
        <div className="topbar">
          {view ? (
            <>
              <div className="crumbs">
                <span>Дорожные карты</span>
                <span>›</span>
                <b>{view.roadmap.title}</b>
                <span>·</span>
                <span className="goal" title={view.roadmap.goal}>
                  {view.roadmap.goal || 'цель не задана'}
                </span>
              </div>
              <span className="spacer" />
              <span className="count" style={{ color: 'var(--muted-2)' }}>
                {totals.done}/{totals.total} задач · {stages.length}{' '}
                {stages.length === 1 ? 'этап' : 'этапов'}
              </span>
              <button
                className="btn"
                onClick={() => {
                  const title = window.prompt('Новое название карты', view.roadmap.title);
                  if (title?.trim() && activeId) void act(() => api.updateRoadmap(activeId, { title: title.trim() }));
                }}
              >
                Переименовать
              </button>
            </>
          ) : (
            <div className="crumbs">Дорожные карты</div>
          )}
        </div>

        {view ? (
          <TaskTree
            stages={stages}
            tasks={view.tasks}
            details={details}
            expanded={expanded}
            flash={flash}
            selectedId={selectedId}
            onSelect={selectTask}
            onToggleExpand={toggleExpand}
            onToggleSubtask={(taskId, subtaskId, done) =>
              activeId && void act(() => api.toggleSubtask(activeId, taskId, subtaskId, done))
            }
            onCreateTask={(stageId) => {
              if (!activeId) return;
              const title = window.prompt('Название новой задачи');
              if (title?.trim()) void act(() => api.createTask(activeId, stageId, title.trim()));
            }}
            registerStage={(stageId, el) => {
              if (el) stageRefs.current.set(stageId, el);
              else stageRefs.current.delete(stageId);
            }}
          />
        ) : (
          <div className="empty-state">
            Карт пока нет.
            <br />
            Создайте первую кнопкой «+» слева — или попросите Claude построить её по вашей цели.
          </div>
        )}
      </main>

      {selected && view && activeId && (
        <TaskPanel
          task={selected}
          tasks={view.tasks}
          onClose={() => setSelectedId(null)}
          onPatch={(patch) => act(() => api.updateTask(activeId, selected.id, { ...patch, version: selected.version }))}
          onStatus={(status: Status, reason?: string) =>
            act(() => api.setStatus(activeId, selected.id, status, reason, selected.version))
          }
          onAddNote={(text) => act(() => api.addNote(activeId, selected.id, text))}
          onDeleteNote={(noteId) => act(() => api.deleteNote(activeId, selected.id, noteId))}
          onAddSubtask={(title) => act(() => api.createSubtask(activeId, selected.id, title))}
          onToggleSubtask={(subtaskId, done) => act(() => api.toggleSubtask(activeId, selected.id, subtaskId, done))}
          onDeleteSubtask={(subtaskId) => act(() => api.deleteSubtask(activeId, selected.id, subtaskId))}
          onJump={selectTask}
        />
      )}

      {error && <div className="toast">{error}</div>}
    </div>
  );
}
