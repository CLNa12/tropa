// Нода канваса = задача (PRD, раздел 8): заголовок, полоска прогресса подзадач,
// цвет по статусу, рамка по цвету этапа. Что именно видно — решает зум:
// класс far/mid/near ставится на полотно, а показ и скрытие делает CSS.
import { Handle, Position, type NodeProps } from 'reactflow';
import type { Status } from '../types';

export interface TaskNodeData {
  title: string;
  status: Status;
  stageColor: string | null;
  stageTitle: string;
  subtasks: { done: number; total: number };
  blockedBy: number;
  description: string;
  flash: boolean;
}

export function TaskNode({ data, selected }: NodeProps<TaskNodeData>) {
  const { done, total } = data.subtasks;
  const percent = total > 0 ? Math.round((done / total) * 100) : data.status === 'done' ? 100 : 0;
  const lines = data.description.split('\n').filter(Boolean).slice(0, 3).join(' ');

  return (
    <div
      className={`node status-${data.status} ${selected ? 'picked' : ''} ${data.flash ? 'flash' : ''}`}
      style={{ borderColor: data.stageColor ?? 'var(--line)' }}
      title={`${data.stageTitle} · ${data.title}`}
    >
      <Handle type="target" position={Position.Left} className="port" />

      <div className="node-head">
        <span className="dot" style={{ background: `var(--${data.status})` }} />
        <span className="node-title">{data.title}</span>
      </div>

      <div className="node-detail">
        {lines ? <div className="node-desc">{lines}</div> : <div className="node-desc empty">описания нет</div>}
      </div>

      <div className="node-foot">
        <div className="node-bar" title={`подзадачи: ${done} из ${total}`}>
          <i style={{ width: `${percent}%`, background: `var(--${data.status})` }} />
        </div>
        <span className="node-count">
          {total > 0 ? `${done}/${total}` : '—'}
          {data.blockedBy > 0 && <b className="node-blocked"> ждёт {data.blockedBy}</b>}
        </span>
      </div>

      <Handle type="source" position={Position.Right} className="port" />
    </div>
  );
}
