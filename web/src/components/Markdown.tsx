// Небольшой разметчик markdown для описаний задач (PRD, раздел 8).
// Своими руками, без библиотеки: нужен ровно тот набор, который пишут в задачах, —
// заголовки, списки, цитаты, код, жирный, курсив и ссылки. Текст превращается
// в обычные элементы React, никакого HTML из строки, поэтому вставить сюда
// чужой скрипт нельзя.
import type { ReactNode } from 'react';

/** Жирный, курсив, `код` и ссылки внутри строки. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/\S+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let n = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const piece = match[0];
    const id = `${key}-${n++}`;
    if (piece.startsWith('`')) {
      out.push(<code key={id}>{piece.slice(1, -1)}</code>);
    } else if (piece.startsWith('**')) {
      out.push(<b key={id}>{piece.slice(2, -2)}</b>);
    } else if (piece.startsWith('*')) {
      out.push(<i key={id}>{piece.slice(1, -1)}</i>);
    } else if (piece.startsWith('[')) {
      const cut = piece.indexOf('](');
      const href = piece.slice(cut + 2, -1);
      out.push(
        <a key={id} href={href} target="_blank" rel="noreferrer noopener">
          {piece.slice(1, cut)}
        </a>,
      );
    } else {
      out.push(
        <a key={id} href={piece} target="_blank" rel="noreferrer noopener">
          {piece}
        </a>,
      );
    }
    last = match.index + piece.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let code: string[] | null = null;

  const closeList = () => {
    if (!list) return;
    const items = list.items.map((item, i) => <li key={i}>{inline(item, `l${blocks.length}-${i}`)}</li>);
    blocks.push(
      list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>,
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    if (line.trim().startsWith('```')) {
      if (code) {
        blocks.push(
          <pre key={blocks.length}>
            <code>{code.join('\n')}</code>
          </pre>,
        );
        code = null;
      } else {
        closeList();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(raw);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      const Tag = (['h4', 'h5', 'h6', 'h6'] as const)[level - 1];
      blocks.push(<Tag key={blocks.length}>{inline(heading[2], `h${blocks.length}`)}</Tag>);
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.ordered !== ordered) {
        closeList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }

    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      closeList();
      blocks.push(<blockquote key={blocks.length}>{inline(quote[1], `q${blocks.length}`)}</blockquote>);
      continue;
    }

    if (line.trim() === '') {
      closeList();
      continue;
    }

    closeList();
    blocks.push(<p key={blocks.length}>{inline(line, `p${blocks.length}`)}</p>);
  }

  closeList();
  if (code) {
    blocks.push(
      <pre key={blocks.length}>
        <code>{code.join('\n')}</code>
      </pre>,
    );
  }

  return <div className="md">{blocks}</div>;
}
