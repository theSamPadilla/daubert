import { Controller, Get, Req } from '@nestjs/common';
import { RequireOrgRole } from '../auth/require-org-role.decorator';
import { DeclarantFilesService } from './declarant-files.service';

/**
 * Org-wide Files tab: every file across every declarant in the org, projected
 * with the declarant's name/link so the frontend can render "Attached to
 * <declarantName>" without a second round trip. Lives as a sibling to
 * `DeclarantsController` (same module, same service) rather than a route on
 * it, since `orgs/:org/files` is not nested under `orgs/:org/declarants`.
 *
 * No new download/delete routes here — the existing per-declarant ones
 * (`orgs/:org/declarants/:declarantId/files/:fileId[/download]`) already
 * cover both, scoped identically through `DeclarantFilesService`.
 */
@Controller('orgs/:org/files')
export class OrgFilesController {
  constructor(private readonly filesService: DeclarantFilesService) {}

  @RequireOrgRole('member')
  @Get()
  async list(@Req() req: any) {
    const files = await this.filesService.listForOrg(req.organization.id);
    return files.map((file) => ({
      id: file.id,
      declarantId: file.declarantId,
      declarantName: file.declarant?.displayName ?? '',
      declarantUserId: file.declarant?.userId ?? null,
      kind: file.kind,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      uploadedByUserId: file.uploadedByUserId,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    }));
  }
}
