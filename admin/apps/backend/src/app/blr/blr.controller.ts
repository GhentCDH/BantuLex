import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import { BlrRequest, BlrUpdateRequest } from './blr.schema.js';
import {
  BlrConflictError, BlrNotFoundError, BlrValidationError,
  createBlr, findByIndex, getBlr, listReflexes, nextIndex, structureOptions, updateBlr,
} from './blr.service.js';

const INVALID = 'The reconstruction is not valid; nothing was saved.';

/** A positive integer path parameter, or 404. */
function positiveId(value: string) {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1) throw new NotFoundException(`Unknown id ${value}`);
  return n;
}

/** Zod-check the body; field errors become a 400 in the format the form shows. */
function parse<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new BadRequestException({
    statusCode: 400,
    message: INVALID,
    errors: parsed.error.issues.map(issue => ({
      field: issue.path.join('.') || 'form',
      message: issue.message,
    })),
  });
}

/** Map the service errors to HTTP errors with the `{field, message}` list. */
async function run<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof BlrNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof BlrValidationError)
      throw new BadRequestException({ statusCode: 400, message: INVALID, errors: error.errors });
    if (error instanceof BlrConflictError)
      throw new ConflictException({ statusCode: 409, message: 'The selected reflexes could not be linked; nothing was saved.', errors: error.errors });
    throw error;
  }
}

/**
 * The reconstruction form: create or edit a BLR reconstruction with its sound
 * structures and reflexes, each save in one transaction.
 */
@Controller('api/blr')
export class BlrController {
  /** GET /api/blr/config — settings the admin UI needs (the public site URL, when set). */
  @Get('config')
  config() {
    return { siteUrl: process.env.SITE_URL?.trim().replace(/\/+$/, '') || null };
  }

  /** GET /api/blr/next-index — the index the next reconstruction will get. */
  @Get('next-index')
  next() {
    return nextIndex();
  }

  /** GET /api/blr/options — distinct values per sound-structure slot. */
  @Get('options')
  options() {
    return structureOptions();
  }

  /** GET /api/blr/reflexes — candidate reflexes (unlinked by default), Crouton list shape. */
  @Get('reflexes')
  reflexes(
    @Query('q') q?: string,
    @Query('variety_id') varietyId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('unlinked') unlinked?: string,
    @Query('owner_id') ownerId?: string,
  ) {
    const int = (value: string | undefined, fallback: number) => {
      const n = Number(value);
      return Number.isSafeInteger(n) && n > 0 ? n : fallback;
    };
    const variety = Number(varietyId);
    const owner = Number(ownerId);
    return listReflexes({
      q: q?.trim() || undefined,
      varietyId: Number.isSafeInteger(variety) && variety > 0 ? variety : null,
      page: int(page, 1),
      pageSize: int(pageSize, 50),
      unlinked: unlinked !== '0' && unlinked !== 'false',
      ownerId: Number.isSafeInteger(owner) && owner > 0 ? owner : null,
    });
  }

  /** GET /api/blr/by-index/:blr — `{id}` of the reconstruction with that BLR index. */
  @Get('by-index/:blr')
  byIndex(@Param('blr') blr: string) {
    return run(() => findByIndex(positiveId(blr)));
  }

  /** GET /api/blr/:id — a reconstruction, its sound structure and its reflexes. */
  @Get(':id')
  one(@Param('id') id: string) {
    return run(() => getBlr(positiveId(id)));
  }

  /** POST /api/blr — one transaction; any failed check rolls everything back. */
  @Post()
  @HttpCode(201)
  create(@Body() body: unknown) {
    const data = parse(BlrRequest, body);
    return run(() => createBlr(data));
  }

  /** PUT /api/blr/:id — update the fields and structure, and set the linked reflexes to exactly `reflex_ids`. */
  @Put(':id')
  update(@Param('id') id: string, @Body() body: unknown) {
    const n = positiveId(id);
    const data = parse(BlrUpdateRequest, body);
    return run(() => updateBlr(n, data));
  }
}
