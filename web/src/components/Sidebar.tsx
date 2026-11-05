// Левая зона: поиск, список карт, этапы активной карты со счётчиками и колечками (PRD, раздел 8).
import type { RefObject } from 'react';
import type { RoadmapSummary, Stage } from '../types';
import { ProgressRing } from './ProgressRing';

export type StageFilter = 'all' | 'active' | 'done';

interface Props {
  roadmaps: RoadmapSummary[];
  activeId: string | null;
  stages: Stage[];
  activeStageId: string | null;
  search: string;
  filter: StageFilter;
  live: boolean;
  storage: string;
  searchRef?: RefObject<HTMLInputElement>;
  onSearch: (value: string) => void;
  onFilter: (value: StageFilter) => void;
  onPickRoadmap: (id: string) => void;
  onPickStage: (id: string) => void;
  onCreateRoadmap: () => void;
  onCreateStage: () => void;
}

const FILTERS: Array<[StageFilter, string]> = [
  ['all', 'Все'],
  ['active', 'Активные'],
  ['done', 'Готовые'],
];

export function Sidebar(props: Props) {
  const q = props.search.trim().toLowerCase();
  const matches = (text: string) => (q ? text.toLowerCase().includes(q) : true);

  const roadmaps = props.roadmaps.filter((r) => matches(r.title));
  const stages = props.stages
    .filter((s) => matches(s.title))
    .filter((s) => {
      const complete = s.progress.total > 0 && s.progress.done === s.progress.total;
      if (props.filter === 'active') return !complete;
      if (props.filter === 'done') return complete;
      return true;
    });

  return (
    <aside className="sidebar">
      <div className="search">
        <input
          ref={props.searchRef}
          value={props.search}
          onChange={(e) => props.onSearch(e.target.value)}
          placeholder="Поиск по картам и этапам  ·  /"
        />
      </div>

      <div className="section-head">
        <span>Дорожные карты</span>
        <button onClick={props.onCreateRoadmap} title="Новая карта">
          +
        </button>
      </div>
      <div className="scroll maps">
        {roadmaps.length === 0 && <div className="row" style={{ color: 'var(--muted-2)' }}>ничего не найдено</div>}
        {roadmaps.map((r) => {
          const complete = r.progress.total > 0 && r.progress.done === r.progress.total;
          return (
            <button
              key={r.id}
              className={`row ${r.id === props.activeId ? 'active' : ''} ${complete ? 'done-all' : ''}`}
              onClick={() => props.onPickRoadmap(r.id)}
              title={r.goal || r.title}
            >
              <ProgressRing done={r.progress.done} total={r.progress.total} />
              <span className="label">{r.title}</span>
              <span className="count">
                {r.progress.done}/{r.progress.total}
              </span>
            </button>
          );
        })}
      </div>

      <div className="section-head">
        <span>Этапы карты</span>
        <button onClick={props.onCreateStage} title="Новый этап" disabled={!props.activeId}>
          +
        </button>
      </div>
      <div className="filters">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            className={props.filter === value ? 'on' : ''}
            onClick={() => props.onFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="scroll stages">
        {stages.length === 0 && (
          <div className="row" style={{ color: 'var(--muted-2)' }}>
            {props.activeId ? 'этапов нет' : 'выберите карту'}
          </div>
        )}
        {stages.map((s) => {
          const complete = s.progress.total > 0 && s.progress.done === s.progress.total;
          return (
            <button
              key={s.id}
              className={`row ${s.id === props.activeStageId ? 'active' : ''} ${complete ? 'done-all' : ''}`}
              onClick={() => props.onPickStage(s.id)}
              title={s.title}
            >
              <ProgressRing done={s.progress.done} total={s.progress.total} color={s.color ?? '#7c6cf0'} />
              <span className="label">{s.title}</span>
              <span className="count">
                {s.progress.done}/{s.progress.total}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-foot" title={props.storage}>
        <span className={`live ${props.live ? '' : 'off'}`} />
        {props.live ? 'живое обновление включено' : 'связь с сервером потеряна'}
      </div>
    </aside>
  );
}
