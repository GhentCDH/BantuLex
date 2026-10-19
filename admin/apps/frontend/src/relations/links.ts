// Routes and requests shared by the relation renderers of the read-only detail view.
import axios from 'axios';

export type RecordEvent = 'view' | 'update' | 'create';

/** Crouton opens a record's modal from the query string of its resource page. */
export const recordRoute = (resource: string, id: number | string | null, event: RecordEvent) =>
  ({ path: `/crouton/${resource}`, query: event === 'create' ? { event } : { id: String(id), event } });

export interface ChildPage { rows: any[]; count: number; totalPages: number }

/**
 * One page of the records of `resource` whose integer foreign key `fk` is `id`.
 * Crouton's `equals` filter passes the value as a string, which Prisma rejects for
 * integer columns; `gt`/`lt` are cast to numbers, so an open interval around the id
 * selects exactly that id.
 */
export async function childPage(resource: string, fk: string, id: number, page: number, pageSize: number, sort = 'id'): Promise<ChildPage> {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort, sortDir: 'asc' });
  params.append('filter', `${fk}:${id - 1}:gt`);
  params.append('filter', `${fk}:${id + 1}:lt`);
  const { data } = await axios.get(`/api/${resource}`, { params });
  return { rows: data.data ?? [], count: data.request?.count ?? 0, totalPages: data.request?.totalPages ?? 0 };
}
