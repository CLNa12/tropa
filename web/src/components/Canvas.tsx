// Канвас (PRD, раздел 8): ноды = задачи, стрелки = зависимости, зум колесом,
// панорамирование, миникарта, автораскладка Dagre. Координаты сохраняются отдельной
// ручкой API (setPosition / setPositions), а не обычной правкой задачи.
import dagre from 'dagre';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlowProvider,
  applyNodeChanges,
  useStore,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Stage, TaskBrief, TaskFull } from '../types';
import { TaskNode, type TaskNodeData } from './TaskNode';

export const NODE_WIDTH = 288;
export const NODE_HEIGHT = 128;

interface Props {
  stages: Stage[];
  tasks: TaskBrief[];
  details: Record<string, TaskFull>;
  flash: Set<string>;
  selectedId: string | null;
  activeStageId: string | null;
  /** Счётчик «подлететь к этапу»: растёт на каждый клик по этапу в сайдбаре. */
  flyToken: number;
  onSelect: (taskId: string) => void;
  onMove: (taskId: string, x: number, y: number) => void;
  onLayout: (positions: { id: string; x: number; y: number }[]) => void;
  onLink: (taskId: string, dependsOn: string) => void;
  onUnlink: (taskId: string, dependsOn: string) => void;
  /** Канвас просит подгрузить описания: их не было в компактном ответе карты. */
  onNeedDescriptions: (need: boolean) => void;
}

const nodeTypes = { task: TaskNode };

/** Автораскладка Dagre: слева направо по зависимостям, задачи одного этапа держатся вместе. */
export function layout(stages: Stage[], tasks: TaskBrief[]) {
  const graph = new dagre.graphlib.Graph({ compound: true });
  graph.setGraph({ rankdir: 'LR', ranksep: 120, nodesep: 34, marginx: 48, marginy: 48 });
  graph.setDefaultEdgeLabel(() => ({}));

  const order = new Map(stages.map((s, i) => [s.id, i]));
  for (const stage of stages) graph.setNode(`cluster_${stage.id}`, {});
  for (const task of tasks) {
    graph.setNode(task.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    if (order.has(task.stageId)) graph.setParent(task.id, `cluster_${task.stageId}`);
  }
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (tasks.some((t) => t.id === dep)) graph.setEdge(dep, task.id);
    }
  }

  dagre.layout(graph);

  const placed = tasks.map((task) => {
    const node = graph.node(task.id) as { x: number; y: number } | undefined;
    // Если Dagre почему-то не дал координату — ставим задачу в колонку своего этапа.
    const fallbackX = (order.get(task.stageId) ?? 0) * (NODE_WIDTH + 120);
    const fallbackY = tasks.filter((t) => t.stageId === task.stageId).indexOf(task) * (NODE_HEIGHT + 34);
    return {
      id: task.id,
      x: Math.round(node ? node.x - NODE_WIDTH / 2 : fallbackX),
      y: Math.round(node ? node.y - NODE_HEIGHT / 2 : fallbackY),
    };
  });

  return wrapLongChain(placed);
}

/**
 * Если задачи идут одной длинной цепочкой, Dagre растягивает карту в строку на тысячи
 * пикселей — целиком она влезает только в нечитаемом масштабе. Такую строку переносим
 * на несколько рядов, порядок задач сохраняется (слева направо, потом следующий ряд).
 */
function wrapLongChain(placed: { id: string; x: number; y: number }[]) {
  if (placed.length < 6) return placed;
  const width = Math.max(...placed.map((p) => p.x)) - Math.min(...placed.map((p) => p.x)) + NODE_WIDTH;
  const height = Math.max(...placed.map((p) => p.y)) - Math.min(...placed.map((p) => p.y)) + NODE_HEIGHT;
  const wide = width > height * 3;
  const tall = height > width * 3;
  if (!wide && !tall) return placed;

  const stepX = NODE_WIDTH + 120;
  const stepY = NODE_HEIGHT + 70;
  const columns = Math.max(2, Math.ceil(Math.sqrt(placed.length)));
  // Строку читаем слева направо, столбик — сверху вниз: порядок задач не меняется.
  const order = [...placed].sort((a, b) => (wide ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x));
  const byId = new Map(
    order.map((p, i) => [
      p.id,
      { x: 48 + (i % columns) * stepX, y: 48 + Math.floor(i / columns) * stepY },
    ]),
  );
  return placed.map((p) => ({ id: p.id, ...byId.get(p.id)! }));
}

/** Все ноды в одной точке — значит раскладки ещё не было (агент координаты не ставит). */
function needsFirstLayout(tasks: TaskBrief[]) {
  if (tasks.length < 2) return false;
  const places = new Set(tasks.map((t) => `${t.x}:${t.y}`));
  return places.size === 1;
}

function zoomBucket(zoom: number) {
  if (zoom < 0.5) return 'far';
  if (zoom >= 0.95) return 'near';
  return 'mid';
}

function CanvasInner(props: Props) {
  const { tasks, stages, details, flash, selectedId, activeStageId, flyToken } = props;
  const flow = useReactFlow();
  const [nodes, setNodes] = useState<Node<TaskNodeData>[]>([]);
  // Уровень приближения берём прямо из состояния канваса: так класс меняется и когда
  // зум крутит человек, и когда канвас сам подлетает к этапу или раскладывает ноды.
  const zoom = useStore((state) => zoomBucket(state.transform[2]));
  const dragging = useRef(false);
  const laidOut = useRef<string | null>(null);

  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s])), [stages]);

  // Ноды пересобираются из данных карты: так живое обновление доходит и до канваса.
  useEffect(() => {
    if (dragging.current) return;
    setNodes(
      tasks.map((task) => {
        const stage = stageById.get(task.stageId);
        return {
          id: task.id,
          type: 'task',
          position: { x: task.x, y: task.y },
          selected: task.id === selectedId,
          data: {
            title: task.title,
            status: task.status,
            stageColor: stage?.color ?? null,
            stageTitle: stage?.title ?? 'без этапа',
            subtasks: task.subtasks,
            blockedBy: task.dependsOn.filter(
              (d) => tasks.find((t) => t.id === d)?.status !== 'done',
            ).length,
            description: details[task.id]?.description ?? '',
            flash: flash.has(task.id),
          },
        };
      }),
    );
  }, [tasks, stageById, details, flash, selectedId]);

  const edges = useMemo<Edge[]>(() => {
    const list: Edge[] = [];
    for (const task of tasks) {
      for (const dep of task.dependsOn) {
        if (!tasks.some((t) => t.id === dep)) continue;
        const ready = tasks.find((t) => t.id === dep)?.status === 'done';
        list.push({
          id: `${dep}->${task.id}`,
          source: dep,
          target: task.id,
          animated: !ready,
          className: ready ? 'edge-ready' : 'edge-waiting',
          style: { strokeWidth: 1.6 },
        });
      }
    }
    return list;
  }, [tasks]);

  // Первый вход на карту без раскладки — раскладываем сами и сохраняем.
  useEffect(() => {
    const key = tasks.map((t) => t.id).join(',');
    if (!key || laidOut.current === key) return;
    if (needsFirstLayout(tasks)) {
      laidOut.current = key;
      props.onLayout(layout(stages, tasks));
    }
  }, [tasks, stages, props]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  // Описания задач тянем только на близком зуме — компактность из ТЗ работает и тут.
  const askDescriptions = props.onNeedDescriptions;
  useEffect(() => {
    askDescriptions(zoom === 'near');
  }, [zoom, askDescriptions]);

  // Клик по этапу в сайдбаре — подлетаем к его группе нод.
  useEffect(() => {
    if (!activeStageId || flyToken === 0) return;
    const group = tasks.filter((t) => t.stageId === activeStageId);
    if (group.length === 0) return;
    const xs = group.map((t) => t.x);
    const ys = group.map((t) => t.y);
    flow.fitBounds(
      {
        x: Math.min(...xs) - 40,
        y: Math.min(...ys) - 40,
        width: Math.max(...xs) - Math.min(...xs) + NODE_WIDTH + 80,
        height: Math.max(...ys) - Math.min(...ys) + NODE_HEIGHT + 80,
      },
      { duration: 500 },
    );
  }, [flyToken, activeStageId, tasks, flow]);

  return (
    <div className={`canvas zoom-${zoom}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStart={() => {
          dragging.current = true;
        }}
        onNodeDragStop={(_, node) => {
          dragging.current = false;
          props.onMove(node.id, Math.round(node.position.x), Math.round(node.position.y));
        }}
        onNodeClick={(_, node) => props.onSelect(node.id)}
        onConnect={(c: Connection) => {
          if (c.source && c.target && c.source !== c.target) props.onLink(c.target, c.source);
        }}
        onEdgesDelete={(removed) => {
          for (const edge of removed) props.onUnlink(edge.target, edge.source);
        }}
        onlyRenderVisibleElements
        minZoom={0.2}
        maxZoom={2}
        fitView
        // Маленькую карту не ужимаем ниже читаемого; большая по-прежнему влезает целиком.
        fitViewOptions={{ padding: 0.2, maxZoom: 1.1, minZoom: tasks.length <= 40 ? 0.7 : 0.1 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        nodesConnectable
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line)" />
        <Controls showInteractive={false} fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(node) => `var(--${(node.data as TaskNodeData).status})`}
          nodeStrokeWidth={0}
          maskColor="rgba(0,0,0,0.55)"
        />
        <Panel position="top-right" className="canvas-panel">
          <button className="btn" onClick={() => props.onLayout(layout(stages, tasks))}>
            Разложить автоматически
          </button>
        </Panel>
      </ReactFlow>
    </div>
  );
}

export function Canvas(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
