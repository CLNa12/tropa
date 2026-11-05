// Один экран, три зоны (PRD, раздел 8). Вся связь с сервером — через api.ts,
// живое обновление — через поток событий /api/events.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from './api';
import { ApiError } from './api';
import { Canvas } from './components/Canvas';
import { HotkeyHelp, PromptSheet, TemplatePicker } from './components/Overlays';
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
  const [mode, setMode] = useState<'list' | 'canvas'>(
    () => (localStorage.getItem('tropa.mode') === 'canvas' ? 'canvas' : 'list'),
  );
  const [flyToken, setFlyToken] = useState(0);
  const [allDetails, setAllDetails] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [templates, setTemplates] = useState<api.TemplateBrief[] | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [promptText, setPromptText] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const stageRefs = useRef(new Map<string, HTMLDivElement>());
  const viewRef = useRef<RoadmapView | null>(null);
  const wanted = useRef<{ expanded: Set<string>; selected: string | null; all: boolean }>({
    expanded: new Set(),
    selected: null,
    all: false,
  });
  wanted.current = { expanded, selected: selectedId, all: allDetails };

  useEffect(() => localStorage.setItem('tropa.mode', mode), [mode]);

  const complain = useCallback((err: unknown) => {
    setError(err instanceof Error ? err.message : String(err));
    window.setTimeout(() => setError(null), 6000);
  }, []);

  const say = useCallback((text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice(null), 2500);
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

      // На близком зуме канвасу нужны описания — тогда тянем подробности по всем задачам,
      // в остальное время только по открытым (правило компактности, PRD раздел 7).
      const needed = new Set(wanted.current.all ? next.tasks.map((t) => t.id) : wanted.current.expanded);
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
    setFlyToken((n) => n + 1); // канвас подлетит к группе нод этого этапа
    stageRefs.current.get(stageId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  /** Канвасу понадобились описания — догружаем их и держим до ухода с близкого зума. */
  const needDescriptions = useCallback(
    (need: boolean) => {
      setAllDetails(need);
      if (!need || !activeId || !viewRef.current) return;
      const missing = viewRef.current.tasks.filter((t) => !details[t.id]).map((t) => t.id);
      if (missing.length === 0) return;
      void Promise.all(missing.map((taskId) => api.getTask(activeId, taskId).catch(() => null)))
        .then((loaded) => {
          setDetails((prev) => {
            const next = { ...prev };
            for (const task of loaded) if (task) next[task.id] = task;
            return next;
          });
        })
        .catch(complain);
    },
    [activeId, details, complain],
  );

  /** Выгрузка карты в markdown: тот же текст, что отдаёт сервер, сохраняется файлом. */
  const exportMap = useCallback(async () => {
    if (!activeId) return;
    try {
      const { markdown, title } = await api.exportMarkdown(activeId);
      const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `${title.replace(/[\\/:*?"<>|]/g, '-')}.md`;
      link.click();
      URL.revokeObjectURL(url);
      say('карта выгружена в markdown');
    } catch (err) {
      complain(err);
    }
  }, [activeId, say, complain]);

  const copyPrompt = useCallback(
    async (taskId: string) => {
      if (!activeId) return;
      let prompt = '';
      try {
        prompt = (await api.taskPrompt(activeId, taskId)).prompt;
      } catch (err) {
        complain(err);
        return;
      }
      try {
        await navigator.clipboard.writeText(prompt);
        say('промпт скопирован — вставьте его Claude');
      } catch {
        // Буфер обмена закрыт браузером: показываем текст, чтобы скопировать руками.
        setPromptText(prompt);
      }
    },
    [activeId, say, complain],
  );

  const openTemplates = useCallback(async () => {
    try {
      const { templates: list } = await api.listTemplates();
      setTemplates(list);
    } catch (err) {
      complain(err);
    }
  }, [complain]);

  const addTask = useCallback(
    (stageId: string) => {
      if (!activeId) return;
      const title = window.prompt('Название новой задачи');
      if (title?.trim()) void act(() => api.createTask(activeId, stageId, title.trim()));
    },
    [activeId, act],
  );

  const selected = selectedId ? details[selectedId] : undefined;
  // Горячие клавиши (PRD, раздел 10, этап 5). Не мешаем печатать: пока курсор в поле
  // ввода, ни одна клавиша не срабатывает.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Escape') {
        setShowHelp(false);
        setTemplates(null);
        setPromptText(null);
        if (!typing) setSelectedId(null);
        return;
      }
      if (typing) return;

      const tasks = viewRef.current?.tasks ?? [];
      const at = tasks.findIndex((t) => t.id === selectedId);
      const step = (shift: number) => {
        if (tasks.length === 0) return;
        const next = tasks[at === -1 ? 0 : Math.min(tasks.length - 1, Math.max(0, at + shift))];
        if (next) selectTask(next.id);
      };

      switch (event.key) {
        case '?':
          setShowHelp((on) => !on);
          break;
        case '/':
          event.preventDefault();
          searchRef.current?.focus();
          break;
        case 'ArrowDown':
        case 'j':
        case 'о': // та же клавиша в русской раскладке
          event.preventDefault();
          step(1);
          break;
        case 'ArrowUp':
        case 'k':
        case 'л':
          event.preventDefault();
          step(-1);
          break;
        case '1':
        case '2':
        case '3':
        case '4': {
          if (!selectedId || !activeId) break;
          const status = (['todo', 'in_progress', 'blocked', 'done'] as Status[])[Number(event.key) - 1];
          if (status === 'blocked') {
            const reason = window.prompt('Чем заблокирована задача?');
            if (!reason?.trim()) break;
            void act(() => api.setStatus(activeId, selectedId, status, reason.trim()));
          } else {
            void act(() => api.setStatus(activeId, selectedId, status));
          }
          break;
        }
        case 'p':
        case 'з':
          if (selectedId) void copyPrompt(selectedId);
          break;
        case 'm':
        case 'ь':
          void exportMap();
          break;
        case 'c':
        case 'с':
          setMode((was) => (was === 'list' ? 'canvas' : 'list'));
          break;
        case 'n':
        case 'т': {
          const stageId = selected?.stageId ?? viewRef.current?.stages[0]?.id;
          if (stageId) addTask(stageId);
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, activeId, selected, act, selectTask, copyPrompt, exportMap, addTask]);

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
        searchRef={searchRef}
        onSearch={setSearch}
        onFilter={setFilter}
        onPickRoadmap={setActiveId}
        onPickStage={pickStage}
        onCreateRoadmap={() => void openTemplates()}
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
              <div className="switch" role="group" aria-label="вид карты">
                <button className={mode === 'list' ? 'on' : ''} onClick={() => setMode('list')}>
                  Список
                </button>
                <button className={mode === 'canvas' ? 'on' : ''} onClick={() => setMode('canvas')}>
                  Канвас
                </button>
              </div>
              <button
                className="btn"
                onClick={() => {
                  const title = window.prompt('Новое название карты', view.roadmap.title);
                  if (title?.trim() && activeId) void act(() => api.updateRoadmap(activeId, { title: title.trim() }));
                }}
              >
                Переименовать
              </button>
              <button className="btn" onClick={() => void exportMap()} title="горячая клавиша: M">
                Выгрузить .md
              </button>
              <button className="btn" onClick={() => setShowHelp(true)} title="горячие клавиши: ?">
                ?
              </button>
            </>
          ) : (
            <div className="crumbs">Дорожные карты</div>
          )}
        </div>

        {view && mode === 'canvas' ? (
          <Canvas
            stages={stages}
            tasks={view.tasks}
            details={details}
            flash={flash}
            selectedId={selectedId}
            activeStageId={activeStageId}
            flyToken={flyToken}
            onSelect={selectTask}
            onMove={(taskId, x, y) => activeId && void act(() => api.setPosition(activeId, taskId, x, y))}
            onLayout={(positions) => activeId && void act(() => api.setPositions(activeId, positions))}
            onLink={(taskId, dependsOn) => activeId && void act(() => api.linkTasks(activeId, taskId, dependsOn))}
            onUnlink={(taskId, dependsOn) =>
              activeId && void act(() => api.unlinkTasks(activeId, taskId, dependsOn))
            }
            onNeedDescriptions={needDescriptions}
          />
        ) : view ? (
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
            onCreateTask={addTask}
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
          onCopyPrompt={() => void copyPrompt(selected.id)}
        />
      )}

      {templates && (
        <TemplatePicker
          templates={templates}
          onClose={() => setTemplates(null)}
          onPick={(templateId, title) => {
            setTemplates(null);
            void act(async () => {
              const created = await api.createFromTemplate(templateId, title);
              setActiveId(created.id);
              say('карта создана');
            });
          }}
        />
      )}

      {showHelp && <HotkeyHelp onClose={() => setShowHelp(false)} />}
      {promptText && <PromptSheet text={promptText} onClose={() => setPromptText(null)} />}

      {error && <div className="toast">{error}</div>}
      {notice && <div className="toast ok">{notice}</div>}
    </div>
  );
}
