import type { BlrRequest, FieldError, Structure } from './blr.schema.js';

// The shared PrismaClient of the default datasource (set from main.ts), as in bulk.service.
let client: any;
export function setPrismaClient(prisma: unknown) { client = prisma; }
const prisma = () => {
  if (!client) throw new Error('BLR entry: Prisma client not set');
  return client;
};

const TRANSACTION = { timeout: 60_000, maxWait: 10_000 };
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export class BlrValidationError extends Error {
  constructor(readonly errors: FieldError[]) { super(`${errors.length} problem(s) in the reconstruction`); }
}
export class BlrConflictError extends Error {
  constructor(readonly errors: FieldError[]) { super('The selected reflexes cannot be linked'); }
}

/** The structure tables and the slots each one owns. */
const STRUCTURES = [
  { idKey: 'consonant_structure_id', model: 'blrconsonantstructure', fields: ['c1', 'c2', 'c3', 'c4', 'cs'] },
  { idKey: 'vowel_structure_id', model: 'blrvowelstructure', fields: ['v11', 'v12', 'v21', 'v22', 'v3', 'v4'] },
  { idKey: 'tone_structure_id', model: 'blrtonestructure', fields: ['t11', 't12', 't21', 't22', 't3', 't4'] },
] as const;

/** Find the exact tuple, or create it; an all-empty structure stays NULL. */
async function structureId(tx: any, model: string, fields: readonly string[], structure: Structure) {
  const data = Object.fromEntries(fields.map(f => [f, (structure as Record<string, string | null>)[f] ?? null]));
  if (Object.values(data).every(v => v == null)) return null;
  const existing = await tx[model].findFirst({ where: data, select: { id: true } });
  if (existing) return existing.id;
  return (await tx[model].create({ data })).id;
}

export async function nextIndex(): Promise<{ blr_index: number }> {
  const max = await prisma().reconstruction.aggregate({ _max: { blr_index: true } });
  return { blr_index: (max._max.blr_index ?? 0) + 1 };
}

/** Distinct values per sound-structure slot, for the form's dropdowns. */
export async function structureOptions(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const { model, fields } of STRUCTURES) {
    for (const field of fields) {
      const rows = await prisma()[model].findMany({
        distinct: [field],
        where: { [field]: { not: null } },
        select: { [field]: true },
        orderBy: { [field]: 'asc' },
      });
      out[field] = rows
        .map((r: Record<string, unknown>) => r[field])
        .filter((v: unknown): v is string => typeof v === 'string' && v.trim() !== '');
    }
  }
  return out;
}

export interface ReflexRow {
  id: number;
  term: string | null;
  translation: string | null;
  meaning: string | null;
  blr_index: string | null;
  blr_entry_id: number | null;
  variety_id: number | null;
  variety_label: string | null;
}

/** Candidate reflexes for linking, in Crouton's list response shape. */
export async function listReflexes(query: {
  q?: string; varietyId?: number | null; page: number; pageSize: number; unlinked: boolean;
}) {
  const where: any = {};
  if (query.unlinked) where.blr_entry_id = null;
  if (query.varietyId) where.variety_id = query.varietyId;
  if (query.q) {
    where.OR = [
      { term: { contains: query.q } },
      { translation: { contains: query.q } },
      { meaning: { contains: query.q } },
      { term_morph_analysis: { contains: query.q } },
      { ipa: { contains: query.q } },
    ];
  }
  const pageSize = Math.max(1, Math.min(500, query.pageSize));
  const page = Math.max(1, query.page);
  const [rows, count] = await Promise.all([
    prisma().reflex.findMany({
      where,
      orderBy: { id: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, term: true, translation: true, meaning: true,
        blr_index: true, blr_entry_id: true, variety_id: true,
        variety: { select: { name_english: true, name_bantu: true, name_french: true, name_bastin: true, guthrie_index: true } },
      },
    }),
    prisma().reflex.count({ where }),
  ]);
  const data: ReflexRow[] = rows.map((r: any) => {
    const v = r.variety;
    const name = v ? (v.name_english ?? v.name_bantu ?? v.name_french ?? v.name_bastin ?? null) : null;
    const label = name ? `${name}${v.guthrie_index ? ` (${v.guthrie_index})` : ''}` : null;
    return {
      id: r.id, term: r.term, translation: r.translation, meaning: r.meaning,
      blr_index: r.blr_index, blr_entry_id: r.blr_entry_id, variety_id: r.variety_id, variety_label: label,
    };
  });
  return {
    data,
    request: {
      count, page, pageSize,
      totalPages: Math.max(1, Math.ceil(count / pageSize)),
    },
  };
}

/**
 * Create a reconstruction, its sound structures and link the selected reflexes
 * in one transaction. Any failed check leaves the database untouched.
 */
export async function createBlr(body: BlrRequest) {
  return prisma().$transaction(async (tx: any) => {
    const errors: FieldError[] = [];
    const ids = [...new Set(body.reflex_ids)];
    if (ids.length !== body.reflex_ids.length)
      errors.push({ field: 'reflex_ids', message: 'The same reflex is selected more than once.' });

    if (body.reconstruction.contributor_id != null
      && !(await tx.blrcontributor.findUnique({ where: { id: body.reconstruction.contributor_id }, select: { id: true } })))
      errors.push({ field: 'contributor_id', message: 'The selected contributor does not exist.' });
    if (body.reconstruction.reliability_id != null
      && !(await tx.blrreliability.findUnique({ where: { id: body.reconstruction.reliability_id }, select: { id: true } })))
      errors.push({ field: 'reliability_id', message: 'The selected reliability does not exist.' });
    if (errors.length) throw new BlrValidationError(errors);

    const reflexes = await tx.reflex.findMany({
      where: { id: { in: ids } },
      select: { id: true, blr_entry_id: true },
    });
    const found = new Set(reflexes.map((r: { id: number }) => r.id));
    const missing = ids.filter(id => !found.has(id));
    const linked = reflexes.filter((r: { blr_entry_id: number | null }) => r.blr_entry_id != null);
    if (missing.length || linked.length) {
      const parts: string[] = [];
      if (missing.length) parts.push(`not found: ${missing.map(id => `#${id}`).join(', ')}`);
      if (linked.length) parts.push(`already linked to a reconstruction: ${linked.map((r: { id: number }) => `#${r.id}`).join(', ')}`);
      throw new BlrConflictError([{ field: 'reflex_ids', message: `Reflexes ${parts.join('; ')}.` }]);
    }

    const structureIds: Record<string, number | null> = {};
    for (const { idKey, model, fields } of STRUCTURES) {
      structureIds[idKey] = await structureId(tx, model, fields, body.structure);
    }

    const max = await tx.reconstruction.aggregate({ _max: { blr_index: true } });
    const index = (max._max.blr_index ?? 0) + 1;
    const reconstruction = await tx.reconstruction.create({
      data: {
        ...body.reconstruction,
        date_of_entry: body.reconstruction.date_of_entry ?? now(),
        blr_index: index,
        ...structureIds,
      },
    });

    const updated = await tx.reflex.updateMany({
      where: { id: { in: ids }, blr_entry_id: null },
      data: { blr_index: String(index), blr_entry_id: reconstruction.id },
    });
    if (updated.count !== ids.length)
      throw new BlrConflictError([{ field: 'reflex_ids', message: 'The selection changed while saving; nothing was saved.' }]);

    return { id: reconstruction.id, blr_index: index, linked: updated.count };
  }, TRANSACTION);
}
