// Requests of the reconstruction form: the BLR API (/api/blr) and the Crouton
// lookup resources it needs. Components and composables do not call axios directly.
import axios from 'axios';
import type { BlrRecord, Option, ReconstructionDraft, ReflexRow, SaveResult } from './types';

export interface SaveBody {
  reconstruction: ReconstructionDraft;
  structure: Record<string, string | null>;
  reflex_ids: number[];
}

export interface ReflexQuery {
  q?: string;
  variety_id?: number;
  page: number;
  pageSize: number;
  unlinked: boolean;
  owner_id?: number | null;
}

export interface ReflexPage { rows: ReflexRow[]; count: number; totalPages: number }

/** Field errors of a failed save: `form` and `reflex_ids` are shown with the save button. */
export interface SaveError { message: string; fields: Record<string, string> }

export const nextIndex = async () => (await axios.get('/api/blr/next-index')).data.blr_index as number | null;

export const structureOptions = async () => ((await axios.get('/api/blr/options')).data ?? {}) as Record<string, string[]>;

async function lookup(resource: string, field: string): Promise<Option[]> {
  const { data } = await axios.get(`/api/${resource}`, { params: { pageSize: 500, sort: field } });
  return (data.data ?? []).map((r: any) => ({ value: r.id, label: r[field]?.trim() || `#${r.id}` }));
}
export const contributors = () => lookup('blrcontributor', 'name');
export const reliability = () => lookup('blrreliability', 'value');

/** The public viewer page of a BLR index, on the same host as the admin (/admin/ next to the site's /). */
export const viewerUrl = (blrIndex: number | string) => `/#/blr/${encodeURIComponent(String(blrIndex))}`;

export const getReconstruction = async (id: number) => (await axios.get(`/api/blr/${id}`)).data as BlrRecord;

export const findByIndex = async (blrIndex: number) => (await axios.get(`/api/blr/by-index/${blrIndex}`)).data.id as number;

export async function saveReconstruction(id: number | null, body: SaveBody): Promise<SaveResult> {
  const { data } = id == null ? await axios.post('/api/blr', body) : await axios.put(`/api/blr/${id}`, body);
  return data;
}

export async function listReflexes(query: ReflexQuery): Promise<ReflexPage> {
  const { data } = await axios.get('/api/blr/reflexes', {
    params: { ...query, unlinked: query.unlinked ? 1 : 0, owner_id: query.owner_id ?? undefined },
  });
  return { rows: data.data ?? [], count: data.request?.count ?? 0, totalPages: data.request?.totalPages ?? 1 };
}

/** The message of a failed request. */
export const errorMessage = (e: any) => e?.response?.data?.message ?? e?.message ?? 'Request failed';

/** Split an API error body into per-field messages and one general message. */
export function saveError(e: any): SaveError {
  const body = e?.response?.data;
  const fields: Record<string, string> = {};
  let message = '';
  for (const error of body?.errors ?? []) {
    const field = String(error.field ?? '').split('.').pop() || 'form';
    if (field === 'reflex_ids' || field === 'form') message = error.message;
    else fields[field] = error.message;
  }
  return { message: message || errorMessage(e) || 'The reconstruction was not saved.', fields };
}
