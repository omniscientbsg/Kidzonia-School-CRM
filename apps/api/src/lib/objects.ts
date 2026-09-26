/** Optional props without `undefined` (what Prisma expects under exactOptionalPropertyTypes). */
export type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/** Drops keys whose value is undefined, so partial updates only touch what was sent. */
export function defined<T extends object>(o: T): Defined<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Defined<T>;
}
