import { Chip, Group, SegmentedControl, Text } from '@mantine/core';
import type { SchoolScope } from '@kidzonia/shared';
import { useSchools } from './queries';

/**
 * Where a role applies for one person: all schools, or chosen ones. Only
 * schools the signed-in person looks after are offered (the server checks too).
 */
export function ScopePicker({
  value,
  onChange,
  allowAll,
  error,
}: {
  value: SchoolScope;
  onChange: (s: SchoolScope) => void;
  allowAll: boolean;
  error?: string | undefined;
}) {
  const schools = useSchools();
  return (
    <div>
      <Text size="sm" fw={600} mb={6}>
        Where this role applies
      </Text>
      {allowAll && (
        <SegmentedControl
          mb="xs"
          value={value.allSchools ? 'all' : 'some'}
          onChange={(v) => {
            onChange({ allSchools: v === 'all', schoolIds: v === 'all' ? [] : value.schoolIds });
          }}
          data={[
            { value: 'all', label: 'All schools' },
            { value: 'some', label: 'Chosen schools' },
          ]}
        />
      )}
      {!value.allSchools && (
        <Chip.Group
          multiple
          value={[...value.schoolIds]}
          onChange={(ids) => {
            onChange({ allSchools: false, schoolIds: ids });
          }}
        >
          <Group gap="xs">
            {(schools.data?.items ?? []).map((s) => (
              <Chip key={s.id} value={s.id}>
                {s.name ?? 'School'}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
      )}
      {error && (
        <Text c="red" size="sm" mt={4}>
          {error}
        </Text>
      )}
    </div>
  );
}
