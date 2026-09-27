import { useDebouncedValue } from '@mantine/hooks';
import { STATUS_LABEL } from '@kidzonia/shared';
import { IconFile, IconSearch, IconSubtask, IconUsers } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useSearch } from '../home/api';

interface Hit {
  key: string;
  icon: ReactNode;
  label: string;
  note: string;
  to: string;
}

/**
 * Search in the top bar (brief 7.5): pages, tasks and people, only what this
 * person may see (the server checks, inside the query). Arrow keys move
 * through the results; Enter opens one; Escape closes.
 */
export function SearchBox() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q] = useDebouncedValue(value.trim(), 250);
  const results = useSearch(q);
  const navigate = useNavigate();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  const data = results.data;
  const hits: Hit[] = data
    ? [
        ...data.pages.map((p) => ({
          key: `p-${p.path}`,
          icon: <IconFile size={16} aria-hidden="true" />,
          label: p.label,
          note: 'Page',
          to: p.path,
        })),
        ...data.tasks.map((t) => ({
          key: `t-${t.id}`,
          icon: <IconSubtask size={16} aria-hidden="true" />,
          label: t.title,
          note: t.status ? STATUS_LABEL[t.status] : 'Task',
          to: `/tasks?task=${t.id}`,
        })),
        ...data.people.map((p) => ({
          key: `u-${p.id}`,
          icon: <IconUsers size={16} aria-hidden="true" />,
          label: p.fullName,
          note: p.schoolName ?? 'Head office',
          to: `/settings/users?q=${encodeURIComponent(p.fullName)}`,
        })),
      ]
    : [];
  const shown = open && q.length >= 2;

  const go = (h: Hit) => {
    setOpen(false);
    setValue('');
    input.current?.blur();
    void navigate(h.to);
  };

  return (
    <div className="search" role="search">
      <IconSearch size={16} className="search-i" aria-hidden="true" />
      <input
        ref={input}
        type="search"
        placeholder="Search tasks, people, pages"
        aria-label="Search"
        autoComplete="off"
        role="combobox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && hits[active] ? `${listId}-${String(active)}` : undefined}
        value={value}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => {
          setOpen(true);
        }}
        onBlur={() => {
          // Let a click on a result land first.
          setTimeout(() => {
            setOpen(false);
          }, 150);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, hits.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && hits[active]) {
            e.preventDefault();
            go(hits[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
      />
      {shown && (
        <div className="results" id={listId} role="listbox" aria-label="Search results">
          {hits.map((h, i) => (
            <div
              key={h.key}
              id={`${listId}-${String(i)}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'hit on' : 'hit'}
              onMouseDown={(e) => {
                e.preventDefault();
                go(h);
              }}
            >
              {h.icon}
              <span className="grow">{h.label}</span>
              <small>{h.note}</small>
            </div>
          ))}
          {hits.length === 0 && !results.isFetching && (
            <p className="empty small">Nothing found.</p>
          )}
        </div>
      )}
    </div>
  );
}
