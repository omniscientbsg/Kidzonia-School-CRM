import type { RecordFacts } from '@kidzonia/shared';
import type { ScopedTx } from '../../db/index.js';

/**
 * How Core reads and writes one module's records when a pending field change
 * is decided. Each module that has "changes need approval" fields registers
 * one; Core never knows the module's tables (brief 6.2 rule 5: "implement the
 * mechanism generically").
 */
export interface FieldChangeHandler {
  /** Current values of the record's props, plus its permission facts. */
  load(
    tx: ScopedTx,
    recordId: string,
  ): Promise<{ values: Record<string, unknown>; facts: RecordFacts; subjectUserId: string } | null>;
  /** Writes the approved props. Must validate as a normal edit would. */
  apply(tx: ScopedTx, recordId: string, props: Record<string, unknown>): Promise<void>;
}

const handlers = new Map<string, FieldChangeHandler>();

export function registerFieldChangeHandler(moduleKey: string, handler: FieldChangeHandler): void {
  handlers.set(moduleKey, handler);
}

export function fieldChangeHandler(moduleKey: string): FieldChangeHandler {
  const h = handlers.get(moduleKey);
  if (!h) throw new Error(`No field-change handler for module "${moduleKey}"`);
  return h;
}
