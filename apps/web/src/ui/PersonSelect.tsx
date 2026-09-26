import { Select } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../api/client';
import { userPage } from '../settings/queries';

interface Props {
  label: string;
  value: string | null;
  /** Name to show for the current value before any search runs. */
  currentName?: string | null | undefined;
  onChange: (id: string | null) => void;
  placeholder?: string | undefined;
  description?: string | undefined;
  error?: string | undefined;
  disabled?: boolean | undefined;
  /** People who can't be chosen (e.g. the person being edited). */
  exclude?: readonly string[] | undefined;
  clearable?: boolean | undefined;
}

/**
 * Picks a person by searching Users. Only people the signed-in person can see
 * come back from the API, so the list never reaches outside their reach.
 */
export function PersonSelect(props: Props) {
  const [search, setSearch] = useState('');
  const [term] = useDebouncedValue(search, 250);
  const people = useQuery({
    queryKey: ['users', 'picker', term],
    queryFn: () =>
      api(
        `/users?limit=20&status=active${term ? `&search=${encodeURIComponent(term)}` : ''}`,
        userPage,
      ),
  });
  const options = useMemo(() => {
    const out = (people.data?.items ?? [])
      .filter((u) => !(props.exclude ?? []).includes(u.id))
      .map((u) => ({
        value: u.id,
        label: [u.fullName ?? 'Someone', u.jobTitle].filter(Boolean).join(', '),
      }));
    if (props.value && !out.some((o) => o.value === props.value)) {
      out.unshift({ value: props.value, label: props.currentName ?? 'Current person' });
    }
    return out;
  }, [people.data, props.value, props.currentName, props.exclude]);

  return (
    <Select
      label={props.label}
      description={props.description}
      placeholder={props.placeholder ?? 'Search by name'}
      data={options}
      value={props.value}
      onChange={props.onChange}
      searchable
      searchValue={search}
      onSearchChange={setSearch}
      clearable={props.clearable ?? true}
      nothingFoundMessage={people.isFetching ? 'Searching…' : 'No one found'}
      error={props.error}
      disabled={props.disabled ?? false}
      filter={({ options: o }) => o}
    />
  );
}
