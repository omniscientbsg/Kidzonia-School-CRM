import {
  homeSchema,
  notificationCountSchema,
  notificationPageSchema,
  personTasksSchema,
  preferencesSchema,
  reportSchema,
  savedViewListSchema,
  savedViewSchema,
  searchSchema,
} from '@kidzonia/shared';
import type { ReportFilters } from '@kidzonia/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';
import { ME_QUERY_KEY } from '../auth/use-me';

export const homeKeys = {
  home: ['home'] as const,
  bell: ['notifications'] as const,
  count: ['notifications', 'count'] as const,
  list: ['notifications', 'list'] as const,
  settings: ['notification-settings'] as const,
  search: (q: string) => ['search', q] as const,
  report: (f: ReportFilters) => ['reports', 'tasks', f] as const,
  person: (id: string, f: ReportFilters) => ['reports', 'person', id, f] as const,
  views: ['saved-views'] as const,
};

/** How often the bell asks for news (Phase 5: polling, no live connection). */
export const POLL_MS = 60_000;

export function useHome() {
  return useQuery({ queryKey: homeKeys.home, queryFn: () => api('/home', homeSchema) });
}

export function useNotificationCount() {
  return useQuery({
    queryKey: homeKeys.count,
    queryFn: () => api('/notifications/count', notificationCountSchema),
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
}

export function useNotifications(enabled: boolean) {
  return useQuery({
    queryKey: homeKeys.list,
    queryFn: () => api('/notifications?limit=20', notificationPageSchema),
    enabled,
  });
}

/** Marks groups (or everything) read, then refreshes the bell and Home. */
export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keys: string[] | 'all') =>
      keys === 'all'
        ? api('/notifications/read-all', z.undefined(), { method: 'POST', noPreview: true })
        : api('/notifications/read', z.undefined(), {
            method: 'POST',
            body: { keys },
            noPreview: true,
          }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: homeKeys.bell });
      void qc.invalidateQueries({ queryKey: homeKeys.home });
    },
  });
}

export function useNotificationSettings() {
  return useQuery({
    queryKey: homeKeys.settings,
    queryFn: () => api('/me/notification-settings', preferencesSchema),
  });
}

export function useSearch(q: string) {
  return useQuery({
    queryKey: homeKeys.search(q),
    queryFn: () => api(`/search?q=${encodeURIComponent(q)}`, searchSchema),
    enabled: q.length >= 2,
    staleTime: 30_000,
  });
}

/** Choosing a school (or all of them) is remembered on the server, per person. */
export function useSelectSchool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (schoolId: string | null) =>
      api('/me/school', z.undefined(), { method: 'PUT', body: { schoolId }, noPreview: true }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ME_QUERY_KEY });
      // Every list may be narrowed differently now.
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    },
  });
}

/** Filters as a query string (only the ones set). */
export function filterQuery(f: ReportFilters): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') p.set(k, v);
  return p.toString();
}

/** The report: summary and options from the first page; people's rows page in 200s. */
export function useReport(f: ReportFilters) {
  return useInfiniteQuery({
    queryKey: homeKeys.report(f),
    queryFn: ({ pageParam }) =>
      api(`/reports/tasks?${filterQuery(f)}&offset=${String(pageParam)}`, reportSchema),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: (prev) => prev,
  });
}

export function usePersonTasks(id: string | null, f: ReportFilters) {
  return useQuery({
    queryKey: homeKeys.person(id ?? '', f),
    queryFn: () =>
      api(
        `/reports/tasks/people/${id ?? ''}?${filterQuery({ range: f.range, from: f.from, to: f.to })}`,
        personTasksSchema,
      ),
    enabled: id !== null,
  });
}

export function useSavedViews() {
  return useQuery({
    queryKey: homeKeys.views,
    queryFn: () => api('/saved-views', savedViewListSchema),
  });
}

export function useSaveView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; filters: ReportFilters }) =>
      api('/saved-views', savedViewSchema, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: homeKeys.views }),
  });
}

export function useDeleteView() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`/saved-views/${id}`, z.undefined(), { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: homeKeys.views }),
  });
}
