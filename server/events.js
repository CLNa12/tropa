// Поток изменений для браузера (PRD, раздел 9: SSE — поток нужен только в одну сторону).
// Событие шлётся из одного места — из storage.writeRoadmap, через которое проходит любая запись.
// Значит ни один способ правки не может «забыть» уведомить вкладку.
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
bus.setMaxListeners(50);

/** Кто записал карту: агент через MCP или человек из браузера. Нужно для подсветки. */
let currentSource = 'agent';

/** Пометить, что ближайшие записи идут от браузера. Ставится HTTP-слоем на каждый запрос. */
export function withSource(source, fn) {
  const previous = currentSource;
  currentSource = source === 'human' ? 'human' : 'agent';
  try {
    return fn();
  } finally {
    currentSource = previous;
  }
}

export function emitChange(type, roadmapId) {
  bus.emit('change', { type, roadmapId, source: currentSource, at: new Date().toISOString() });
}

export function onChange(listener) {
  bus.on('change', listener);
  return () => bus.off('change', listener);
}
