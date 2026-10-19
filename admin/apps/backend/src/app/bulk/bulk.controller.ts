import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { BulkRequest } from './bulk.schema.js';
import { BulkValidationError, NotFound, UndoConflict, importReflexes, listImports, undoImport } from './bulk.service.js';

/** Bulk import of reflexes from the admin's spreadsheet grid, and undo per batch. */
@Controller('api/bulk')
export class BulkController {
  /** POST /api/bulk/reflex?dryRun=1 — one transaction; a dry run rolls back and only reports. */
  @Post('reflex')
  @HttpCode(200)
  async importReflexes(@Body() body: unknown, @Query('dryRun') dryRun?: string) {
    const parsed = BulkRequest.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        statusCode: 400, message: 'The import is not valid; nothing was saved.',
        errors: parsed.error.issues.map(issue => {
          const [first, index, field] = issue.path;
          return first === 'rows' && typeof index === 'number'
            ? { row: index + 1, field: String(field ?? 'row'), message: issue.message }
            : { row: null, field: issue.path.join('.'), message: issue.message };
        }),
      });
    }
    try {
      return await importReflexes(parsed.data, dryRun === '1' || dryRun === 'true');
    } catch (error) {
      if (error instanceof BulkValidationError)
        throw new BadRequestException({ statusCode: 400, message: 'The import is not valid; nothing was saved.', errors: error.errors });
      throw error;
    }
  }

  /** GET /api/bulk/imports — recent batches. */
  @Get('imports')
  list() {
    return listImports();
  }

  /** POST /api/bulk/imports/:id/undo — remove the batch's reflexes in one transaction. */
  @Post('imports/:id/undo')
  @HttpCode(200)
  async undo(@Param('id') id: string) {
    const n = Number(id);
    if (!Number.isSafeInteger(n) || n <= 0) throw new BadRequestException('Invalid bulk import id');
    try {
      return await undoImport(n);
    } catch (error) {
      if (error instanceof NotFound) throw new NotFoundException(error.message);
      if (error instanceof UndoConflict) throw new ConflictException(error.message);
      throw error;
    }
  }
}
