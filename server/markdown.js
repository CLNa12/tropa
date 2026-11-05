// Экспорт карты в markdown (PRD, раздел 10, этап 5). Получается документ, который
// можно прочитать глазами, вставить в заметки или отдать другому агенту.
const MARK = { todo: ' ', in_progress: '~', blocked: '!', done: 'x' };
const WORD = {
  todo: 'не начата',
  in_progress: 'в работе',
  blocked: 'заблокирована',
  done: 'готова',
};

const date = (iso) => new Date(iso).toLocaleDateString('ru-RU');

/** Карта целиком в markdown. `file` — то, что лежит в JSON-файле карты. */
export function roadmapToMarkdown(file) {
  const { roadmap, stages, tasks } = file;
  const checklistOf = (task) => [...task.subtasks].sort((a, b) => a.order - b.order);
  const title = (id) => tasks.find((t) => t.id === id)?.title ?? id;
  const done = tasks.filter((t) => t.status === 'done').length;

  const out = [`# ${roadmap.title}`, ''];
  if (roadmap.goal) out.push(`**Цель:** ${roadmap.goal}`, '');
  out.push(`**Прогресс:** ${done} из ${tasks.length} задач · этапов: ${stages.length}`, '');
  if (roadmap.context) out.push('## Вводные', '', roadmap.context, '');

  for (const stage of [...stages].sort((a, b) => a.order - b.order)) {
    const own = tasks.filter((t) => t.stageId === stage.id);
    const ready = own.filter((t) => t.status === 'done').length;
    out.push(`## ${stage.title} — ${ready}/${own.length}`, '');

    for (const task of own) {
      out.push(`### [${MARK[task.status]}] ${task.title}`, '');
      const facts = [`статус: ${WORD[task.status]}`];
      if (task.estimate !== null && task.estimate !== undefined) facts.push(`оценка: ${task.estimate} ч`);
      if (task.dependsOn.length > 0) facts.push(`ждёт: ${task.dependsOn.map(title).join(', ')}`);
      out.push(`*${facts.join(' · ')}*`, '');

      if (task.description) out.push(task.description, '');

      const checklist = checklistOf(task);
      if (checklist.length > 0) {
        out.push(...checklist.map((s) => `- [${s.done ? 'x' : ' '}] ${s.title}`), '');
      }
      if (task.acceptance.length > 0) {
        out.push('**Критерии приёмки:**', '', ...task.acceptance.map((a) => `- ${a}`), '');
      }
      if (task.files.length > 0) {
        out.push('**Файлы:**', '', ...task.files.map((f) => `- \`${f}\``), '');
      }
      if (task.notes.length > 0) {
        out.push('**Заметки:**', '');
        for (const note of task.notes) {
          out.push(`- ${date(note.createdAt)}, ${note.author === 'agent' ? 'Claude' : 'владелец'}: ${note.text}`);
        }
        out.push('');
      }
    }
  }

  out.push('---', '', `Выгружено из Tropa ${new Date().toLocaleString('ru-RU')}.`, '');
  return out.join('\n');
}

/** Короткий промпт по одной задаче — для кнопки «Скопировать промпт для Claude». */
export function taskToPrompt(file, task) {
  const stage = file.stages.find((s) => s.id === task.stageId);
  const checklist = [...task.subtasks].sort((a, b) => a.order - b.order);
  const title = (id) => file.tasks.find((t) => t.id === id)?.title ?? id;
  const blockers = task.dependsOn
    .map((id) => file.tasks.find((t) => t.id === id))
    .filter((t) => t && t.status !== 'done');

  const out = [
    `Карта «${file.roadmap.title}», этап «${stage?.title ?? 'без этапа'}».`,
    `Задача: ${task.title}`,
    '',
  ];
  if (file.roadmap.goal) out.push(`Общая цель: ${file.roadmap.goal}`, '');
  if (task.description) out.push(task.description, '');
  if (checklist.length > 0) {
    out.push('Шаги:', ...checklist.map((s) => `- [${s.done ? 'x' : ' '}] ${s.title}`), '');
  }
  if (task.acceptance.length > 0) {
    out.push('Задача считается сделанной, когда:', ...task.acceptance.map((a) => `- ${a}`), '');
  }
  if (task.files.length > 0) out.push('Файлы: ' + task.files.join(', '), '');
  if (blockers.length > 0) out.push('Сначала нужно закрыть: ' + blockers.map((t) => t.title).join(', '), '');
  out.push(
    `Когда закончишь — отметь задачу в Tropa: set_status (id карты ${file.roadmap.id}, id задачи ${task.id}) и add_note с тем, что сделано.`,
  );
  return out.join('\n');
}
