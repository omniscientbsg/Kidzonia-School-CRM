import {
  holidaySchema,
  organisationSchema,
  pageSchema,
  roleSummarySchema,
  schoolSchema,
  userSchema,
} from '@kidzonia/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';

export const keys = {
  organisation: ['organisation'] as const,
  checklist: ['organisation', 'checklist'] as const,
  holidays: ['holidays'] as const,
  schools: ['schools'] as const,
  users: ['users'] as const,
  roles: ['roles'] as const,
  assignable: ['roles', 'assignable'] as const,
  role: (id: string) => ['roles', id] as const,
  holders: (id: string) => ['roles', id, 'holders'] as const,
  automatic: ['automatic-roles'] as const,
  changes: ['field-changes'] as const,
  profile: ['profile'] as const,
};

export const schoolPage = pageSchema(schoolSchema);
export const userPage = pageSchema(userSchema);
export const holidayPage = pageSchema(holidaySchema);
export const rolePage = pageSchema(roleSummarySchema);
export const assignablePage = pageSchema(
  z.object({ id: z.string(), name: z.string(), seedKey: z.string().nullable() }),
);

/** Every school this person can see (organisations have a handful, not thousands). */
export function useSchools(enabled = true) {
  return useQuery({
    queryKey: keys.schools,
    queryFn: () => api('/schools?limit=200', schoolPage),
    enabled,
  });
}

export function useOrganisation() {
  return useQuery({
    queryKey: keys.organisation,
    queryFn: () => api('/organisation', organisationSchema),
    // The settings form is keyed on this data; don't refetch it under someone's edits.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useAssignableRoles(enabled = true) {
  return useQuery({
    queryKey: keys.assignable,
    queryFn: () => api('/roles/assignable?limit=200', assignablePage),
    enabled,
  });
}
