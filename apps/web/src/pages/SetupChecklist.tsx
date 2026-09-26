import { Button } from '@mantine/core';
import { checklistSchema } from '@kidzonia/shared';
import { IconCheck } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { z } from 'zod';
import { api } from '../api/client';
import { keys } from '../settings/queries';

/** "Set up your organisation" on Home for people who run the organisation (brief 8.1). */
export function SetupChecklist() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: keys.checklist,
    queryFn: () => api('/organisation/checklist', checklistSchema),
  });
  const hide = useMutation({
    mutationFn: () => api('/organisation/checklist/dismiss', z.undefined(), { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.checklist }),
  });
  if (!list.data || list.data.dismissed) return null;
  return (
    <section className="panel checklist-panel" aria-labelledby="setup-h">
      <div className="panel-h">
        <h2 id="setup-h">Set up your organisation</h2>
        <Button
          size="xs"
          variant="subtle"
          onClick={() => {
            hide.mutate();
          }}
        >
          Hide
        </Button>
      </div>
      <div className="checklist">
        {list.data.items.map((i) => (
          <div key={i.key} className={i.done ? 'ci' : 'ci todo'}>
            <span className="ring" aria-hidden="true">
              {i.done && <IconCheck size={14} />}
            </span>
            <span className="grow">
              <b>{i.label}</b> <span className="small muted">{i.detail}</span>
              <span className="visually-hidden">{i.done ? ' (done)' : ' (to do)'}</span>
            </span>
            <Button size="xs" variant="default" component={Link} to={i.path}>
              Open
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}
