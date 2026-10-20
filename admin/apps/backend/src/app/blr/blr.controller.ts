import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { BlrRequest } from './blr.schema.js';
import { BlrConflictError, BlrValidationError, createBlr, listReflexes, nextIndex, structureOptions } from './blr.service.js';

/** Create a BLR reconstruction with its sound structures and reflexes in one transaction. */
@Controller('api/blr')
export class BlrController {
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
  ) {
    const int = (value: string | undefined, fallback: number) => {
      const n = Number(value);
      return Number.isSafeInteger(n) && n > 0 ? n : fallback;
    };
    const variety = Number(varietyId);
    return listReflexes({
      q: q?.trim() || undefined,
      varietyId: Number.isSafeInteger(variety) && variety > 0 ? variety : null,
      page: int(page, 1),
      pageSize: int(pageSize, 50),
      unlinked: unlinked !== '0' && unlinked !== 'false',
    });
  }

  /** POST /api/blr — one transaction; any failed check rolls everything back. */
  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    const parsed = BlrRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'The reconstruction is not valid; nothing was saved.',
        errors: parsed.error.issues.map(issue => ({
          field: issue.path.join('.') || 'form',
          message: issue.message,
        })),
      });
    }
    try {
      return await createBlr(parsed.data);
    } catch (error) {
      if (error instanceof BlrValidationError)
        throw new BadRequestException({ statusCode: 400, message: 'The reconstruction is not valid; nothing was saved.', errors: error.errors });
      if (error instanceof BlrConflictError)
        throw new ConflictException({ statusCode: 409, message: 'The selected reflexes could not be linked; nothing was saved.', errors: error.errors });
      throw error;
    }
  }
}
