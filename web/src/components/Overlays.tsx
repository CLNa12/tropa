// Два окошка поверх экрана: выбор шаблона новой карты и подсказка по горячим клавишам
// (PRD, раздел 10, этап 5).
import { useEffect, useState } from 'react';
import type { TemplateBrief } from '../api';

function Shade({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="shade" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function TemplatePicker({
  templates,
  onPick,
  onClose,
}: {
  templates: TemplateBrief[];
  onPick: (templateId: string, title: string) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(templates[0]?.id ?? 'blank');
  const [title, setTitle] = useState('');
  const chosen = templates.find((t) => t.id === picked);
  const name = title.trim() || chosen?.title || 'Новая карта';

  return (
    <Shade onClose={onClose}>
      <h2>Новая карта</h2>
      <div className="tpl-list">
        {templates.map((t) => (
          <button
            key={t.id}
            className={`tpl ${t.id === picked ? 'on' : ''}`}
            onClick={() => setPicked(t.id)}
          >
            <b>{t.title}</b>
            <span>{t.about}</span>
            <i>{t.tasks > 0 ? `${t.stages} этапа · ${t.tasks} задач` : 'с чистого листа'}</i>
          </button>
        ))}
      </div>
      <div className="add-row">
        <input
          autoFocus
          value={title}
          placeholder={chosen?.title ?? 'название карты'}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onPick(picked, name)}
        />
        <button className="btn primary" onClick={() => onPick(picked, name)}>
          Создать
        </button>
      </div>
    </Shade>
  );
}

const KEYS: [string, string][] = [
  ['↑ ↓ или J K', 'перейти к соседней задаче'],
  ['1 2 3 4', 'статус: не начата, в работе, заблокирована, готова'],
  ['P', 'скопировать промпт для Claude'],
  ['N', 'новая задача в этом этапе'],
  ['C', 'переключить список и канвас'],
  ['M', 'выгрузить карту в markdown'],
  ['/', 'поиск в сайдбаре'],
  ['Esc', 'закрыть панель или окно'],
  ['?', 'эта подсказка'],
];

export function HotkeyHelp({ onClose }: { onClose: () => void }) {
  return (
    <Shade onClose={onClose}>
      <h2>Горячие клавиши</h2>
      <div className="keys">
        {KEYS.map(([key, what]) => (
          <div className="key-row" key={key}>
            <kbd>{key}</kbd>
            <span>{what}</span>
          </div>
        ))}
      </div>
      <p className="hint">Клавиши не срабатывают, пока вы печатаете в поле ввода.</p>
    </Shade>
  );
}

/** Запасной путь: если буфер обмена закрыт браузером — показываем текст, чтобы скопировать руками. */
export function PromptSheet({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <Shade onClose={onClose}>
      <h2>Промпт для Claude</h2>
      <textarea
        autoFocus
        readOnly
        rows={16}
        value={text}
        onFocus={(e) => e.currentTarget.select()}
      />
      <p className="hint">
        Браузер не дал положить текст в буфер сам — он уже выделен, нажмите Ctrl+C.
      </p>
    </Shade>
  );
}
