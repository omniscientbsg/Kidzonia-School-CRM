import { Button } from '@mantine/core';
import { IconFilter } from '@tabler/icons-react';
import { useSelectSchool } from '../home/api';
import { notify } from '../ui/notify';
import { errorMessage } from '../ui/errors';
import { useMeData } from './AppLayout';
import type { MeData } from '../auth/use-me';

/**
 * The school switcher (brief 7.6): only for people with more than one school
 * in scope. The choice is stored on the server per person and narrows lists
 * there; the bell, notifications and your own Approvals are never narrowed.
 */
export function SchoolSwitcher({ data }: { data: MeData }) {
  const { me } = data;
  const select = useSelectSchool();
  if (me.switchableSchools.length < 2) return null;
  const everyone = me.role?.isOwner === true || me.scope.allSchools;
  return (
    <select
      className="barsel"
      aria-label="Choose school"
      value={me.selectedSchool?.id ?? ''}
      disabled={select.isPending}
      onChange={(e) => {
        select.mutate(e.currentTarget.value || null, {
          onError: (err) => {
            notify(errorMessage(err));
          },
        });
      }}
    >
      <option value="">{everyone ? 'All schools' : 'All my schools'}</option>
      {me.switchableSchools.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

/**
 * On screens the switcher narrows: "Showing Kondapur only · Show all"
 * (Phase 5 answer 5). Not shown on Approvals or My tasks, which never narrow.
 */
export function NarrowedChip() {
  const { me } = useMeData();
  const select = useSelectSchool();
  if (!me.selectedSchool) return null;
  return (
    <div className="narrowed" role="status">
      <IconFilter size={16} aria-hidden="true" />
      <span>Showing {me.selectedSchool.name} only</span>
      <Button
        size="compact-sm"
        variant="subtle"
        loading={select.isPending}
        onClick={() => {
          select.mutate(null);
        }}
      >
        Show all
      </Button>
    </div>
  );
}
