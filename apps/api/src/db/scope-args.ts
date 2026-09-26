import { Prisma } from '../generated/prisma/client.js';

/** Raised when code tries to step outside its organisation. Always a bug, never user input. */
export class TenancyViolation extends Error {
  override name = 'TenancyViolation';
}

/** Models that aren't owned by one organisation. Everything else is scoped by default. */
export const UNSCOPED_MODELS: ReadonlySet<string> = new Set([
  'OtpChallenge',
  'RateLimit',
  'OneTimeToken',
]);

export interface ScopeOptions {
  /**
   * Registration only: allows creating THIS organisation's row, so the whole
   * sign-up (organisation, schools, roles, people) is one transaction.
   */
  creatingOrganisation?: boolean;
}

/** The organisation table is scoped by its own id rather than organisation_id. */
const ORGANISATION_MODEL = 'Organisation';

// Prisma exposes each model's scalar fields as `<Model>ScalarFieldEnum`. Any
// data key outside that set is a relation, i.e. a nested write, which could
// create rows in other tables without passing through this scoping.
const prismaNamespace = Prisma as unknown as Record<string, Record<string, string> | undefined>;
const SCALAR_FIELDS = new Map<string, ReadonlySet<string>>(
  Object.values(Prisma.ModelName).map((model) => [
    model,
    new Set(Object.values(prismaNamespace[`${model}ScalarFieldEnum`] ?? {})),
  ]),
);

const UNIQUE_WHERE_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'upsert']);
const FILTER_OPS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'updateManyAndReturn',
  'deleteMany',
]);
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

type Args = Record<string, unknown>;

const isPlainObject = (v: unknown): v is Args =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

function orgFilter(model: string, organisationId: string): Args {
  return model === ORGANISATION_MODEL ? { id: organisationId } : { organisationId };
}

function asArray(v: unknown): unknown[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function checkWriteData(
  model: string,
  data: unknown,
  organisationId: string,
  isCreate: boolean,
  options: ScopeOptions = {},
): Args {
  if (!isPlainObject(data)) throw new TenancyViolation(`${model}: write data must be an object`);
  const scalars = SCALAR_FIELDS.get(model);
  if (!scalars) throw new TenancyViolation(`Unknown model ${model}`);
  for (const key of Object.keys(data)) {
    if (!scalars.has(key)) {
      throw new TenancyViolation(
        `${model}.${key}: nested writes are not allowed through the scoped client; write each table directly`,
      );
    }
  }
  if (model === ORGANISATION_MODEL) {
    if (isCreate) {
      if (options.creatingOrganisation && data.id === organisationId) return data;
      throw new TenancyViolation('Organisations are created by registration only');
    }
    if ('id' in data) throw new TenancyViolation('Organisation id is immutable');
    return data;
  }
  if ('organisationId' in data && data.organisationId !== organisationId) {
    throw new TenancyViolation(`${model}: organisationId does not match the current organisation`);
  }
  if (!isCreate && 'organisationId' in data) {
    throw new TenancyViolation(`${model}: organisationId can't be changed`);
  }
  return isCreate ? { ...data, organisationId } : data;
}

/**
 * Rewrites the arguments of one Prisma operation so it can only see and touch
 * rows of `organisationId`. Pure, so it's unit-tested directly; the Prisma
 * extension in `scoped.ts` calls it for every query.
 */
export function scopeArgs(
  model: string,
  operation: string,
  rawArgs: unknown,
  organisationId: string,
  options: ScopeOptions = {},
): unknown {
  if (UNSCOPED_MODELS.has(model)) return rawArgs;
  const args: Args = isPlainObject(rawArgs) ? { ...rawArgs } : {};
  const filter = orgFilter(model, organisationId);

  if (UNIQUE_WHERE_OPS.has(operation)) {
    if (!isPlainObject(args.where)) throw new TenancyViolation(`${model}.${operation} needs where`);
    // Prisma accepts extra filters next to the unique key; AND keeps any the caller passed.
    args.where = { ...args.where, AND: [...asArray(args.where.AND), filter] };
  } else if (FILTER_OPS.has(operation)) {
    args.where = { AND: [...(args.where === undefined ? [] : [args.where]), filter] };
  } else if (!CREATE_OPS.has(operation)) {
    // Fail closed on anything new Prisma adds rather than let it through unscoped.
    throw new TenancyViolation(
      `Operation ${model}.${operation} is not supported by the scoped client`,
    );
  }

  if (CREATE_OPS.has(operation)) {
    const data = args.data;
    args.data = Array.isArray(data)
      ? data.map((d) => checkWriteData(model, d, organisationId, true))
      : checkWriteData(model, data, organisationId, true, options);
  } else if (UPDATE_OPS.has(operation)) {
    args.data = checkWriteData(model, args.data, organisationId, false);
  } else if (operation === 'upsert') {
    args.create = checkWriteData(model, args.create, organisationId, true);
    args.update = checkWriteData(model, args.update, organisationId, false);
  } else if (operation === 'delete' || operation === 'deleteMany') {
    if (model === ORGANISATION_MODEL) throw new TenancyViolation('Organisations are never deleted');
  }
  return args;
}
