import { z } from 'zod';
import { idSchema } from './ids.js';

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

/**
 * Cursor pagination. The cursor is the id of the last item on the previous
 * page; ids are UUIDv7 so they are time-ordered and index-friendly, and unlike
 * offsets they don't skip or repeat rows when data changes between pages.
 */
export const pageQuerySchema = z.object({
  cursor: idSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(MAX_PAGE_SIZE, `Limit can be at most ${MAX_PAGE_SIZE}`)
    .default(DEFAULT_PAGE_SIZE),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/**
 * Turns `limit + 1` fetched rows into a page. Fetching one extra row is how we
 * know whether another page exists without a second COUNT query.
 */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? last.id : null };
}
