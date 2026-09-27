import {
  assignablePersonSchema,
  copyDetailSchema,
  copyRowSchema,
  pageSchema,
  taskDetailSchema,
  taskRowSchema,
  taskSetupSchema,
  targetPreviewResultSchema,
  templateSchema,
} from '@kidzonia/shared';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { api } from '../api/client';

export const taskKeys = {
  all: ['tasks'] as const,
  setup: ['tasks', 'setup'] as const,
  templates: ['tasks', 'templates'] as const,
  lists: ['tasks', 'list'] as const,
  copies: ['tasks', 'copies'] as const,
  detail: (id: string, copy: string | null) => ['tasks', 'detail', id, copy] as const,
  targetOptions: ['tasks', 'target-options'] as const,
};

export const copyPage = pageSchema(copyRowSchema);
export const taskPage = pageSchema(taskRowSchema);
export const templatePage = pageSchema(templateSchema);
export const peoplePage = pageSchema(assignablePersonSchema);
export const targetOptionsSchema = z.object({
  canAssign: z.boolean(),
  roles: z.array(z.object({ id: z.string(), name: z.string() })),
  schools: z.array(z.object({ id: z.string(), name: z.string() })),
});
export const previewSchema = targetPreviewResultSchema;

export { copyDetailSchema, taskDetailSchema };

/** Categories, priorities, lists and messages: small, shared by every task screen. */
export function useTaskSetup() {
  return useQuery({
    queryKey: taskKeys.setup,
    queryFn: () => api('/task-setup', taskSetupSchema),
    staleTime: 60_000,
  });
}

export function useTemplates(enabled: boolean) {
  return useQuery({
    queryKey: taskKeys.templates,
    queryFn: () => api('/task-setup/templates?limit=200', templatePage),
    enabled,
  });
}
