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

export const NODE_WIDTH = 216;
export const NODE_HEIGHT = 92;

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
  graph.setGraph({ rankdir: 'LR', ranksep: 90, nodesep: 26, marginx: 40, marginy: 40 });
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

  return tasks.map((task) => {
    const node = graph.node(task.id) as { x: number; y: number } | undefined;
    // Если Dagre почему-то не дал координату — ставим задачу в колонку своего этапа.
    const fallbackX = (order.get(task.stageId) ?? 0) * (NODE_WIDTH + 90);
    const fallbackY = tasks.filter((t) => t.stageId === task.stageId).indexOf(task) * (NODE_HEIGHT + 26);
    return {
      id: task.id,
      x: Math.round(node ? node.x - NODE_WIDTH / 2 : fallbackX),
      y: Math.round(node ? node.y - NODE_HEIGHT / 2 : fallbackY),
    };
  });
}

/** Все ноды в одной точке — значит раскладки ещё не было (агент координаты не ставит). */
function needsFirstLayout(tasks: TaskBrief[]) {
  if (tasks.length < 2) return false;
  const places = new Set(tasks.map((t) => `${t.x}:${t.y}`));
  return places.size === 1;
}

function zoomBucket(zoom: number) {
  if (zoom < 0.6) return 'far';
  if (zoom >= 1.15) return 'near';
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
        minZoom={0.2}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={['Backspace', 'Delete']}
        nodesConnectable
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--line)" />
        <Controls showInteractive={false} />
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
