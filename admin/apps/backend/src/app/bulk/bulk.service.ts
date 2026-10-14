import type { BulkRequest, RowError } from './bulk.schema.js';

// The shared PrismaClient of the default datasource (set from main.ts). Importing
// data-sources/default/index.js here would create a second client: esbuild
// bundles every entry file on its own.
let client: any;
export function setPrismaClient(prisma: unknown) { client = prisma; }
const prisma = () => {
  if (!client) throw new Error('Bulk import: Prisma client not set');
  return client;
};

const CHUNK = 500;
// The whole import runs in one SQLite transaction; 5000 rows take a few seconds.
const TRANSACTION = { timeout: 120_000, maxWait: 10_000 };
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

export class BulkValidationError extends Error {
  constructor(readonly errors: RowError[]) { super(`${errors.length} problem(s) in the import`); }
}
class DryRunRollback extends Error {
  constructor(readonly summary: Summary) { super('dry run'); }
}

export interface Summary {
  dryRun: boolean;
  bulkimport_id: number | null;
  rows: number;
  blr_linked: number;
  blr_unknown: number[];
  blr_text: number;
  source: { id: number | null; created: boolean };
  variety: { id: number | null; created: boolean };
}

// "9094 ipv 3604": 9094 replaces ("in plaats van") 3604 — same rule as the importer.
const IPV = /^\s*(\d+)\s+ipv\b/i;
function parseBlr(raw: string | null): { index: number | null; note: string | null } {
  if (raw == null) return { index: null, note: null };
  if (/^\d+$/.test(raw)) return { index: Number(raw), note: null };
  const m = IPV.exec(raw);
  return m ? { index: Number(m[1]), note: raw } : { index: null, note: raw };
}

/** Validate references and rows that zod cannot check (existence in the database). */
async function checkReferences(tx: any, body: BulkRequest): Promise<RowError[]> {
  const errors: RowError[] = [];
  body.rows.forEach((r, i) => { if (!r.term) errors.push({ row: i + 1, field: 'term', message: 'Term is empty' }); });
  const exists = async (model: string, id: number | null | undefined, field: string) => {
    if (id != null && !(await tx[model].findUnique({ where: { id }, select: { id: true } })))
      errors.push({ row: null, field, message: `No ${model} with id ${id}` });
  };
  if ('id' in body.source) await exists('source', body.source.id, 'source');
  if (body.variety && 'id' in body.variety) await exists('variety', body.variety.id, 'variety');
  await exists('location', body.location_id, 'location_id');
  await exists('fieldwork', body.fieldwork_id, 'fieldwork_id');
  return errors;
}

/** Import all rows in one transaction; a dry run does the same work and rolls back. */
export async function importReflexes(body: BulkRequest, dryRun: boolean): Promise<Summary> {
  try {
    return await prisma().$transaction(async (tx: any) => {
      const errors = await checkReferences(tx, body);
      if (errors.length) throw new BulkValidationError(errors);

      const source = 'id' in body.source
        ? { id: body.source.id, created: false }
        : { id: (await tx.source.create({ data: body.source.create })).id, created: true };
      const variety = !body.variety ? { id: null, created: false }
        : 'id' in body.variety ? { id: body.variety.id, created: false }
        : { id: (await tx.variety.create({ data: body.variety.create })).id, created: true };

      const batch = await tx.bulkimport.create({
        data: {
          label: body.label, note: body.note, rows: body.rows.length, status: 'saved', role: body.role,
          source_id: source.id, variety_id: variety.id,
          location_id: body.location_id ?? null, fieldwork_id: body.fieldwork_id ?? null,
          source_created: source.created, variety_created: variety.created,
        },
      });

      // BLR index → reconstruction, as in the importer: unknown text is kept as a note.
      const parsed = body.rows.map(r => parseBlr(r.blr_index));
      const wanted = [...new Set(parsed.map(p => p.index).filter((n): n is number => n != null))];
      const found = new Map<number, number>();
      for (let i = 0; i < wanted.length; i += CHUNK) {
        const recs = await tx.reconstruction.findMany({ where: { blr_index: { in: wanted.slice(i, i + CHUNK) } }, select: { id: true, blr_index: true } });
        for (const r of recs) found.set(r.blr_index, r.id);
      }

      let linked = 0, text = 0;
      const unknown = new Set<number>();
      for (let i = 0; i < body.rows.length; i += CHUNK) {
        const data = body.rows.slice(i, i + CHUNK).map((r, j) => {
          const blr = parsed[i + j];
          const blrId = blr.index != null ? found.get(blr.index) ?? null : null;
          if (blrId) linked++;
          else if (blr.index != null) unknown.add(blr.index);
          if (blr.index == null && blr.note) text++;
          return {
            term: r.term, translation: r.translation, meaning: r.meaning, part_of_speech: r.part_of_speech,
            term_morph_analysis: r.term_morph_analysis, semantic_field: r.semantic_field,
            scientific_name: r.scientific_name, notes: r.notes,
            blr_index: blr.index != null ? String(blr.index) : null, blr_note: blr.note,
            blr_entry_id: blrId, variety_id: variety.id, location_id: body.location_id ?? null,
            fieldwork_id: body.fieldwork_id ?? null, bulkimport_id: batch.id,
          };
        });
        const created = await tx.reflex.createManyAndReturn({ data, select: { id: true } });
        await tx.sourceentries.createMany({
          data: created.map((c: { id: number }, j: number) => ({
            entry_id: c.id, source_id: source.id, role: body.role, order: 1, pages: body.rows[i + j].pages,
          })),
        });
      }

      const summary: Summary = {
        dryRun, bulkimport_id: dryRun ? null : batch.id, rows: body.rows.length,
        blr_linked: linked, blr_unknown: [...unknown].sort((a, b) => a - b), blr_text: text, source, variety,
      };
      if (dryRun) throw new DryRunRollback({ ...summary, source: { ...source, id: source.created ? null : source.id }, variety: { ...variety, id: variety.created ? null : variety.id } });
      return summary;
    }, TRANSACTION);
  } catch (error) {
    if (error instanceof DryRunRollback) return error.summary;
    throw error;
  }
}

export class UndoConflict extends Error {}
export class NotFound extends Error {}

/** Remove every reflex (and its source links) of a batch, and records the batch created if now unused. */
export async function undoImport(id: number) {
  return prisma().$transaction(async (tx: any) => {
    const batch = await tx.bulkimport.findUnique({ where: { id } });
    if (!batch) throw new NotFound(`No bulk import ${id}`);
    if (batch.status === 'undone') throw new UndoConflict(`Bulk import ${id} was already undone on ${batch.undone_at}`);

    const links = await tx.sourceentries.deleteMany({ where: { entry: { bulkimport_id: id } } });
    const reflexes = await tx.reflex.deleteMany({ where: { bulkimport_id: id } });

    let sourceRemoved = false, varietyRemoved = false;
    const update: Record<string, unknown> = { status: 'undone', undone_at: now() };
    if (batch.source_created && batch.source_id != null) {
      const used = await tx.sourceentries.count({ where: { source_id: batch.source_id } })
        + await tx.bulkimport.count({ where: { source_id: batch.source_id, id: { not: id } } });
      if (!used) { update.source_id = null; sourceRemoved = true; }
    }
    if (batch.variety_created && batch.variety_id != null) {
      const used = await tx.reflex.count({ where: { variety_id: batch.variety_id } })
        + await tx.bulkimport.count({ where: { variety_id: batch.variety_id, id: { not: id } } });
      if (!used) { update.variety_id = null; varietyRemoved = true; }
    }
    await tx.bulkimport.update({ where: { id }, data: update });
    if (sourceRemoved) await tx.source.delete({ where: { id: batch.source_id } });
    if (varietyRemoved) await tx.variety.delete({ where: { id: batch.variety_id } });

    return { id, reflexes: reflexes.count, source_links: links.count, source_removed: sourceRemoved, variety_removed: varietyRemoved };
  }, TRANSACTION);
}

/** Most recent batches, with the number of their reflexes still in the database. */
export async function listImports() {
  const rows = await prisma().bulkimport.findMany({
    orderBy: { id: 'desc' }, take: 200,
    include: { source: { select: { author_year: true } }, variety: { select: { name_english: true, guthrie_index: true } }, _count: { select: { reflex: true } } },
  });
  return rows.map((b: any) => ({
    id: b.id, label: b.label, note: b.note, rows: b.rows, status: b.status, created_at: b.created_at, undone_at: b.undone_at,
    role: b.role, source: b.source?.author_year ?? null, variety: b.variety ? `${b.variety.name_english}${b.variety.guthrie_index ? ` (${b.variety.guthrie_index})` : ''}` : null,
    reflexes_now: b._count.reflex,
  }));
}
