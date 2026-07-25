import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { ProductionEntity, ProductionType } from '../../database/entities/production.entity';
import { CaseAccessService } from '../auth/case-access.service';
import { AccessPrincipal } from '../auth/access-principal';
import { CaseRole } from '../../database/entities/case-member.entity';
import { CreateProductionDto } from './dto/create-production.dto';
import { UpdateProductionDto } from './dto/update-production.dto';
import { HighlightColor, isHighlightColor } from './chronology-highlights';
import { ColumnDef, ChronologyEntry, seedChronologyData, normalizeEntry, isReservedColumnKey } from './chronology-schema';
import {
  DeclarationCaption,
  DeclarationData,
  DeclarationExhibit,
  DeclarationParagraph,
  DeclarationSection,
  DeclarationSectionKind,
  DeclarationSubItem,
  DeclarationFootnote,
  seedDeclarationData,
  nextExhibitLabel,
} from './declaration-data';
import { RedlineIngestService } from './redline-ingest.service';
import {
  RedlineComment,
  RedlineEdit,
  RedlineEditKind,
  RedlineEditStatus,
  resolveAnchor,
  spansOverlap,
} from './redline-data';

// Discriminated union of atomic ops. The list is intentionally small —
// extend with `report_*` and `chart_*` shapes as those types acquire
// equivalent token-cost issues. The discriminator is the `op` field.
type Op =
  | { op: 'chronology_append'; entries: ChronologyEntry[] }
  | { op: 'chronology_replace'; index: number; entry: ChronologyEntry }
  | { op: 'chronology_delete'; indexes: number[] }
  | { op: 'chronology_set_column_widths'; widths: Record<string, number> }
  | { op: 'chronology_set_row_highlight'; indexes: number[]; color: HighlightColor | null }
  | { op: 'chronology_add_column'; column: ColumnDef; index?: number }
  | { op: 'chronology_remove_column'; key: string }
  | { op: 'chronology_update_column'; key: string; patch: { label?: string; width?: number } }
  | { op: 'chronology_reorder_columns'; keys: string[] }
  | { op: 'chart_set_height'; height: number }
  | { op: 'declaration_set_caption'; caption: Partial<DeclarationCaption> }
  | { op: 'declaration_set_execution'; execution: Partial<DeclarationData['execution']> }
  | { op: 'declaration_add_section'; kind: DeclarationSectionKind; heading: string; afterSectionId?: string }
  | {
      op: 'declaration_add_paragraph';
      sectionId: string;
      text: string;
      subItems?: { text: string }[];
      exhibitIds?: string[];
      footnotes?: { text: string }[];
      afterParagraphId?: string;
    }
  | {
      op: 'declaration_update_paragraph';
      paragraphId: string;
      text?: string;
      subItems?: { id?: string; text: string }[];
      exhibitIds?: string[];
      footnotes?: { id?: string; text: string }[];
    }
  | { op: 'declaration_remove_paragraph'; paragraphId: string }
  | { op: 'declaration_add_exhibit'; label?: string; description: string; source?: DeclarationExhibit['source'] }
  | { op: 'declaration_update_exhibit'; exhibitId: string; label?: string; description?: string; source?: DeclarationExhibit['source'] }
  | {
      op: 'redline_add_edit';
      kind: RedlineEditKind;
      anchorText: string;
      newText: string;
      basis: string;
      comment?: string;
      origin?: string;
    }
  | { op: 'redline_update_edit'; editId: string; status?: RedlineEditStatus; newText?: string; basis?: string; comment?: string }
  | { op: 'redline_remove_edit'; editId: string }
  | { op: 'redline_add_comment'; title: string; text: string }
  | { op: 'redline_update_comment'; commentId: string; title?: string; text?: string }
  | { op: 'redline_dismiss_comment'; commentId: string; dismissed: boolean }
  | { op: 'redline_remove_comment'; commentId: string };

const CHART_HEIGHT_MIN = 200;
const CHART_HEIGHT_MAX = 1200;

const DECLARATION_SECTION_KINDS: readonly DeclarationSectionKind[] = [
  'qualifications',
  'assignment',
  'summary_of_opinions',
  'background',
  'authentication',
  'findings',
  'conclusions',
  'recommendations',
  'custom',
];

@Injectable()
export class ProductionsService {
  constructor(
    @InjectRepository(ProductionEntity)
    private readonly repo: Repository<ProductionEntity>,
    private readonly caseAccess: CaseAccessService,
    private readonly redlineIngest: RedlineIngestService,
  ) {}

  async findAllForCase(caseId: string, principal: AccessPrincipal, type?: ProductionType) {
    await this.caseAccess.assertRole(principal, caseId, 'viewer');
    const where: any = { caseId };
    if (type) where.type = type;
    return this.repo.find({ where, order: { createdAt: 'ASC' } });
  }

  async findOne(id: string, principal: AccessPrincipal, minRole: CaseRole = 'viewer') {
    const production = await this.repo.findOneBy({ id });
    if (!production) throw new NotFoundException(`Production ${id} not found`);
    await this.caseAccess.assertRole(principal, production.caseId, minRole);
    return production;
  }

  async create(caseId: string, dto: CreateProductionDto, principal: AccessPrincipal) {
    await this.caseAccess.assertRole(principal, caseId, 'editor');
    let data: Record<string, unknown>;
    if (dto.type === ProductionType.CHRONOLOGY) {
      data = seedChronologyData(dto.data as Record<string, unknown> | undefined) as unknown as Record<string, unknown>;
    } else if (dto.type === ProductionType.DECLARATION) {
      data = seedDeclarationData(dto.data as Partial<DeclarationData> | undefined) as unknown as Record<string, unknown>;
    } else if (dto.type === ProductionType.REDLINE) {
      const sourceFileId = (dto.data as any)?.sourceFileId;
      if (typeof sourceFileId !== 'string' || !sourceFileId) {
        throw new BadRequestException('redline productions require data.sourceFileId');
      }
      const actorUserId = 'userId' in principal ? principal.userId : 'system';
      data = (await this.redlineIngest.buildData(caseId, sourceFileId, actorUserId)) as unknown as Record<string, unknown>;
    } else {
      data = dto.data;
    }
    const production = this.repo.create({ ...dto, data, caseId });
    return this.repo.save(production);
  }

  async update(id: string, dto: UpdateProductionDto, principal: AccessPrincipal) {
    if (dto.data !== undefined && dto.ops !== undefined) {
      throw new BadRequestException('`data` and `ops` are mutually exclusive');
    }

    const production = await this.findOne(id, principal, 'editor');

    // Redline productions are ops-only: their baseText snapshot is immutable, so
    // a full `data` replacement is never allowed.
    if (production.type === ProductionType.REDLINE && dto.data !== undefined) {
      throw new BadRequestException('redline productions are ops-only');
    }
    // The redline boundary is one-way sealed: a production cannot be converted
    // into or out of the redline type (XOR rejects transitions in either direction).
    if (
      dto.type !== undefined &&
      (dto.type === ProductionType.REDLINE) !== (production.type === ProductionType.REDLINE)
    ) {
      throw new BadRequestException('cannot change a production type to or from "redline"');
    }

    if (dto.name !== undefined) production.name = dto.name;
    if (dto.type !== undefined) production.type = dto.type;

    if (dto.data !== undefined) {
      production.data = dto.data;
    } else if (dto.ops !== undefined) {
      const actorUserId = 'userId' in principal ? principal.userId : 'system';
      production.data = applyOps(production.type, production.data ?? {}, dto.ops, actorUserId);
    }

    return this.repo.save(production);
  }

  async remove(id: string, principal: AccessPrincipal) {
    const production = await this.findOne(id, principal, 'editor');
    await this.repo.remove(production);
  }
}

// Pure function — applies ops sequentially. Each op operates on the state
// produced by the previous ops in the same call.
function applyOps(
  type: ProductionType,
  initial: Record<string, unknown>,
  rawOps: Record<string, unknown>[],
  actorUserId: string,
): Record<string, unknown> {
  let data: Record<string, unknown> = { ...initial };
  rawOps.forEach((raw, i) => {
    const op = parseOp(raw, i);
    data = applyOp(type, data, op, i, actorUserId);
  });
  return data;
}

function parseOp(raw: Record<string, unknown>, i: number): Op {
  const opName = raw.op;
  if (typeof opName !== 'string') {
    throw new BadRequestException(`ops[${i}]: missing string \`op\` discriminator`);
  }
  switch (opName) {
    case 'chronology_append': {
      if (!Array.isArray(raw.entries) || raw.entries.length === 0) {
        throw new BadRequestException(`ops[${i}] (chronology_append): \`entries\` must be a non-empty array`);
      }
      return { op: 'chronology_append', entries: raw.entries as ChronologyEntry[] };
    }
    case 'chronology_replace': {
      if (typeof raw.index !== 'number' || !Number.isInteger(raw.index) || raw.index < 0) {
        throw new BadRequestException(`ops[${i}] (chronology_replace): \`index\` must be a non-negative integer`);
      }
      if (raw.entry === null || typeof raw.entry !== 'object') {
        throw new BadRequestException(`ops[${i}] (chronology_replace): \`entry\` must be an object`);
      }
      return { op: 'chronology_replace', index: raw.index, entry: raw.entry as ChronologyEntry };
    }
    case 'chronology_delete': {
      if (
        !Array.isArray(raw.indexes) ||
        raw.indexes.length === 0 ||
        !raw.indexes.every((n): n is number => Number.isInteger(n) && (n as number) >= 0)
      ) {
        throw new BadRequestException(`ops[${i}] (chronology_delete): \`indexes\` must be a non-empty array of non-negative integers`);
      }
      return { op: 'chronology_delete', indexes: raw.indexes as number[] };
    }
    case 'chronology_set_column_widths': {
      if (raw.widths === null || typeof raw.widths !== 'object') {
        throw new BadRequestException(`ops[${i}] (chronology_set_column_widths): \`widths\` must be an object`);
      }
      const widths: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw.widths as Record<string, unknown>)) {
        if (v === undefined) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 5 || v > 80) {
          throw new BadRequestException(`ops[${i}] (chronology_set_column_widths): widths.${k} must be a number between 5 and 80`);
        }
        widths[k] = v;
      }
      return { op: 'chronology_set_column_widths', widths };
    }
    case 'chronology_set_row_highlight': {
      if (
        !Array.isArray(raw.indexes) ||
        raw.indexes.length === 0 ||
        !raw.indexes.every((n): n is number => Number.isInteger(n) && (n as number) >= 0)
      ) {
        throw new BadRequestException(`ops[${i}] (chronology_set_row_highlight): \`indexes\` must be a non-empty array of non-negative integers`);
      }
      if (raw.color !== null && !isHighlightColor(raw.color)) {
        throw new BadRequestException(`ops[${i}] (chronology_set_row_highlight): \`color\` must be one of yellow|gray|red|green|blue or null`);
      }
      return { op: 'chronology_set_row_highlight', indexes: raw.indexes as number[], color: raw.color as HighlightColor | null };
    }
    case 'chronology_add_column': {
      const col = raw.column;
      if (col === null || typeof col !== 'object') {
        throw new BadRequestException(`ops[${i}] (chronology_add_column): \`column\` must be an object`);
      }
      const c = col as Record<string, unknown>;
      if (typeof c.key !== 'string' || !c.key.trim()) {
        throw new BadRequestException(`ops[${i}] (chronology_add_column): column.key must be a non-empty string`);
      }
      if (isReservedColumnKey(c.key)) {
        throw new BadRequestException(`ops[${i}] (chronology_add_column): "${c.key}" is a reserved column key`);
      }
      if (typeof c.label !== 'string' || !c.label.trim()) {
        throw new BadRequestException(`ops[${i}] (chronology_add_column): column.label must be a non-empty string`);
      }
      if (typeof c.width !== 'number' || !Number.isFinite(c.width) || c.width < 5 || c.width > 80) {
        throw new BadRequestException(`ops[${i}] (chronology_add_column): column.width must be a number between 5 and 80`);
      }
      if (c.kind !== 'text') {
        throw new BadRequestException(`ops[${i}] (chronology_add_column): column.kind must be "text" (link reserved for built-in source column)`);
      }
      let index: number | undefined;
      if (raw.index !== undefined) {
        if (typeof raw.index !== 'number' || !Number.isInteger(raw.index) || raw.index < 0) {
          throw new BadRequestException(`ops[${i}] (chronology_add_column): \`index\` must be a non-negative integer`);
        }
        index = raw.index;
      }
      return {
        op: 'chronology_add_column',
        column: { key: c.key, label: c.label, width: c.width, kind: 'text' },
        index,
      };
    }
    case 'chronology_remove_column': {
      if (typeof raw.key !== 'string' || !raw.key.trim()) {
        throw new BadRequestException(`ops[${i}] (chronology_remove_column): \`key\` must be a non-empty string`);
      }
      return { op: 'chronology_remove_column', key: raw.key };
    }
    case 'chronology_update_column': {
      if (typeof raw.key !== 'string' || !raw.key.trim()) {
        throw new BadRequestException(`ops[${i}] (chronology_update_column): \`key\` must be a non-empty string`);
      }
      if (raw.patch === null || typeof raw.patch !== 'object') {
        throw new BadRequestException(`ops[${i}] (chronology_update_column): \`patch\` must be an object`);
      }
      const patch = raw.patch as Record<string, unknown>;
      if ('key' in patch) {
        throw new BadRequestException(`ops[${i}] (chronology_update_column): cannot change column key`);
      }
      if ('kind' in patch) {
        throw new BadRequestException(`ops[${i}] (chronology_update_column): cannot change column kind`);
      }
      const out: { label?: string; width?: number } = {};
      if (patch.label !== undefined) {
        if (typeof patch.label !== 'string' || !patch.label.trim()) {
          throw new BadRequestException(`ops[${i}] (chronology_update_column): patch.label must be a non-empty string`);
        }
        out.label = patch.label;
      }
      if (patch.width !== undefined) {
        if (typeof patch.width !== 'number' || !Number.isFinite(patch.width) || patch.width < 5 || patch.width > 80) {
          throw new BadRequestException(`ops[${i}] (chronology_update_column): patch.width must be a number between 5 and 80`);
        }
        out.width = patch.width;
      }
      return { op: 'chronology_update_column', key: raw.key, patch: out };
    }
    case 'chronology_reorder_columns': {
      if (!Array.isArray(raw.keys) || raw.keys.length === 0) {
        throw new BadRequestException(`ops[${i}] (chronology_reorder_columns): \`keys\` must be a non-empty array`);
      }
      if (!raw.keys.every((k): k is string => typeof k === 'string')) {
        throw new BadRequestException(`ops[${i}] (chronology_reorder_columns): \`keys\` must be an array of strings`);
      }
      return { op: 'chronology_reorder_columns', keys: raw.keys as string[] };
    }
    case 'chart_set_height': {
      if (
        typeof raw.height !== 'number' ||
        !Number.isFinite(raw.height) ||
        raw.height < CHART_HEIGHT_MIN ||
        raw.height > CHART_HEIGHT_MAX
      ) {
        throw new BadRequestException(
          `ops[${i}] (chart_set_height): \`height\` must be a number between ${CHART_HEIGHT_MIN} and ${CHART_HEIGHT_MAX}`,
        );
      }
      return { op: 'chart_set_height', height: Math.round(raw.height) };
    }
    case 'declaration_set_caption': {
      if (raw.caption === null || typeof raw.caption !== 'object') {
        throw new BadRequestException(`ops[${i}] (declaration_set_caption): \`caption\` must be an object`);
      }
      return { op: 'declaration_set_caption', caption: raw.caption as Partial<DeclarationCaption> };
    }
    case 'declaration_set_execution': {
      if (raw.execution === null || typeof raw.execution !== 'object') {
        throw new BadRequestException(`ops[${i}] (declaration_set_execution): \`execution\` must be an object`);
      }
      return { op: 'declaration_set_execution', execution: raw.execution as Partial<DeclarationData['execution']> };
    }
    case 'declaration_add_section': {
      if (typeof raw.kind !== 'string' || !DECLARATION_SECTION_KINDS.includes(raw.kind as DeclarationSectionKind)) {
        throw new BadRequestException(`ops[${i}] (declaration_add_section): \`kind\` must be one of ${DECLARATION_SECTION_KINDS.join('|')}`);
      }
      if (typeof raw.heading !== 'string') {
        throw new BadRequestException(`ops[${i}] (declaration_add_section): \`heading\` must be a string`);
      }
      if (raw.afterSectionId !== undefined && typeof raw.afterSectionId !== 'string') {
        throw new BadRequestException(`ops[${i}] (declaration_add_section): \`afterSectionId\` must be a string`);
      }
      return {
        op: 'declaration_add_section',
        kind: raw.kind as DeclarationSectionKind,
        heading: raw.heading,
        afterSectionId: raw.afterSectionId as string | undefined,
      };
    }
    case 'declaration_add_paragraph': {
      if (typeof raw.sectionId !== 'string' || !raw.sectionId.trim()) {
        throw new BadRequestException(`ops[${i}] (declaration_add_paragraph): \`sectionId\` must be a non-empty string`);
      }
      if (typeof raw.text !== 'string') {
        throw new BadRequestException(`ops[${i}] (declaration_add_paragraph): \`text\` must be a string`);
      }
      const subItems = parseTextItems(raw.subItems, i, 'declaration_add_paragraph', 'subItems');
      const footnotes = parseTextItems(raw.footnotes, i, 'declaration_add_paragraph', 'footnotes');
      const exhibitIds = parseStringArray(raw.exhibitIds, i, 'declaration_add_paragraph', 'exhibitIds');
      if (raw.afterParagraphId !== undefined && typeof raw.afterParagraphId !== 'string') {
        throw new BadRequestException(`ops[${i}] (declaration_add_paragraph): \`afterParagraphId\` must be a string`);
      }
      return {
        op: 'declaration_add_paragraph',
        sectionId: raw.sectionId,
        text: raw.text,
        subItems,
        exhibitIds,
        footnotes,
        afterParagraphId: raw.afterParagraphId as string | undefined,
      };
    }
    case 'declaration_update_paragraph': {
      if (typeof raw.paragraphId !== 'string' || !raw.paragraphId.trim()) {
        throw new BadRequestException(`ops[${i}] (declaration_update_paragraph): \`paragraphId\` must be a non-empty string`);
      }
      if (raw.text !== undefined && typeof raw.text !== 'string') {
        throw new BadRequestException(`ops[${i}] (declaration_update_paragraph): \`text\` must be a string`);
      }
      const subItems = raw.subItems === undefined
        ? undefined
        : parseIdTextItems(raw.subItems, i, 'declaration_update_paragraph', 'subItems');
      const footnotes = raw.footnotes === undefined
        ? undefined
        : parseIdTextItems(raw.footnotes, i, 'declaration_update_paragraph', 'footnotes');
      const exhibitIds = raw.exhibitIds === undefined
        ? undefined
        : parseStringArray(raw.exhibitIds, i, 'declaration_update_paragraph', 'exhibitIds');
      return {
        op: 'declaration_update_paragraph',
        paragraphId: raw.paragraphId,
        text: raw.text as string | undefined,
        subItems,
        exhibitIds,
        footnotes,
      };
    }
    case 'declaration_remove_paragraph': {
      if (typeof raw.paragraphId !== 'string' || !raw.paragraphId.trim()) {
        throw new BadRequestException(`ops[${i}] (declaration_remove_paragraph): \`paragraphId\` must be a non-empty string`);
      }
      return { op: 'declaration_remove_paragraph', paragraphId: raw.paragraphId };
    }
    case 'declaration_add_exhibit': {
      if (raw.label !== undefined && (typeof raw.label !== 'string' || !raw.label.trim())) {
        throw new BadRequestException(`ops[${i}] (declaration_add_exhibit): \`label\` must be a non-empty string`);
      }
      if (typeof raw.description !== 'string') {
        throw new BadRequestException(`ops[${i}] (declaration_add_exhibit): \`description\` must be a string`);
      }
      if (raw.source !== undefined && raw.source !== null && typeof raw.source !== 'object') {
        throw new BadRequestException(`ops[${i}] (declaration_add_exhibit): \`source\` must be an object or null`);
      }
      return {
        op: 'declaration_add_exhibit',
        label: raw.label as string | undefined,
        description: raw.description,
        source: raw.source as DeclarationExhibit['source'] | undefined,
      };
    }
    case 'declaration_update_exhibit': {
      if (typeof raw.exhibitId !== 'string' || !raw.exhibitId.trim()) {
        throw new BadRequestException(`ops[${i}] (declaration_update_exhibit): \`exhibitId\` must be a non-empty string`);
      }
      if (raw.label !== undefined && (typeof raw.label !== 'string' || !raw.label.trim())) {
        throw new BadRequestException(`ops[${i}] (declaration_update_exhibit): \`label\` must be a non-empty string`);
      }
      if (raw.description !== undefined && typeof raw.description !== 'string') {
        throw new BadRequestException(`ops[${i}] (declaration_update_exhibit): \`description\` must be a string`);
      }
      if (raw.source !== undefined && raw.source !== null && typeof raw.source !== 'object') {
        throw new BadRequestException(`ops[${i}] (declaration_update_exhibit): \`source\` must be an object or null`);
      }
      return {
        op: 'declaration_update_exhibit',
        exhibitId: raw.exhibitId,
        label: raw.label as string | undefined,
        description: raw.description as string | undefined,
        source: raw.source as DeclarationExhibit['source'] | undefined,
      };
    }
    case 'redline_add_edit': {
      const kind = raw.kind;
      if (kind !== 'replace' && kind !== 'delete' && kind !== 'insert_after') {
        throw new BadRequestException(`ops[${i}] (redline_add_edit): \`kind\` must be one of replace|delete|insert_after`);
      }
      if (typeof raw.anchorText !== 'string' || !raw.anchorText.trim()) {
        throw new BadRequestException(`ops[${i}] (redline_add_edit): \`anchorText\` must be a non-empty string`);
      }
      if (typeof raw.basis !== 'string' || !raw.basis.trim()) {
        throw new BadRequestException(`ops[${i}] (redline_add_edit): \`basis\` must be a non-empty string`);
      }
      let newText: string;
      if (kind === 'delete') {
        if (raw.newText !== undefined && raw.newText !== '') {
          throw new BadRequestException(`ops[${i}] (redline_add_edit): \`newText\` must be absent or empty for kind "delete"`);
        }
        newText = '';
      } else {
        if (typeof raw.newText !== 'string' || raw.newText.length === 0) {
          throw new BadRequestException(`ops[${i}] (redline_add_edit): \`newText\` must be a non-empty string for kind "${kind}"`);
        }
        newText = raw.newText;
      }
      if (raw.comment !== undefined && typeof raw.comment !== 'string') {
        throw new BadRequestException(`ops[${i}] (redline_add_edit): \`comment\` must be a string`);
      }
      if (raw.origin !== undefined && typeof raw.origin !== 'string') {
        throw new BadRequestException(`ops[${i}] (redline_add_edit): \`origin\` must be a string`);
      }
      return {
        op: 'redline_add_edit',
        kind,
        anchorText: raw.anchorText,
        newText,
        basis: raw.basis,
        comment: raw.comment as string | undefined,
        origin: raw.origin as string | undefined,
      };
    }
    case 'redline_update_edit': {
      if (typeof raw.editId !== 'string' || !raw.editId.trim()) {
        throw new BadRequestException(`ops[${i}] (redline_update_edit): \`editId\` must be a non-empty string`);
      }
      if ('anchorText' in raw || 'anchor' in raw || 'kind' in raw) {
        throw new BadRequestException(`ops[${i}] (redline_update_edit): anchor and kind are immutable`);
      }
      let status: RedlineEditStatus | undefined;
      if (raw.status !== undefined) {
        if (raw.status !== 'proposed' && raw.status !== 'accepted' && raw.status !== 'rejected') {
          throw new BadRequestException(`ops[${i}] (redline_update_edit): \`status\` must be one of proposed|accepted|rejected`);
        }
        status = raw.status;
      }
      if (raw.newText !== undefined && typeof raw.newText !== 'string') {
        throw new BadRequestException(`ops[${i}] (redline_update_edit): \`newText\` must be a string`);
      }
      if (raw.basis !== undefined && (typeof raw.basis !== 'string' || !raw.basis.trim())) {
        throw new BadRequestException(`ops[${i}] (redline_update_edit): \`basis\` must be a non-empty string`);
      }
      if (raw.comment !== undefined && typeof raw.comment !== 'string') {
        throw new BadRequestException(`ops[${i}] (redline_update_edit): \`comment\` must be a string`);
      }
      return {
        op: 'redline_update_edit',
        editId: raw.editId,
        status,
        newText: raw.newText as string | undefined,
        basis: raw.basis as string | undefined,
        comment: raw.comment as string | undefined,
      };
    }
    case 'redline_remove_edit': {
      if (typeof raw.editId !== 'string' || !raw.editId.trim()) {
        throw new BadRequestException(`ops[${i}] (redline_remove_edit): \`editId\` must be a non-empty string`);
      }
      return { op: 'redline_remove_edit', editId: raw.editId };
    }
    case 'redline_add_comment': {
      if (typeof raw.title !== 'string') {
        throw new BadRequestException(`ops[${i}] (redline_add_comment): \`title\` must be a string`);
      }
      if (typeof raw.text !== 'string') {
        throw new BadRequestException(`ops[${i}] (redline_add_comment): \`text\` must be a string`);
      }
      return { op: 'redline_add_comment', title: raw.title, text: raw.text };
    }
    case 'redline_update_comment': {
      if (typeof raw.commentId !== 'string' || !raw.commentId.trim()) {
        throw new BadRequestException(`ops[${i}] (redline_update_comment): \`commentId\` must be a non-empty string`);
      }
      if (raw.title !== undefined && typeof raw.title !== 'string') {
        throw new BadRequestException(`ops[${i}] (redline_update_comment): \`title\` must be a string`);
      }
      if (raw.text !== undefined && typeof raw.text !== 'string') {
        throw new BadRequestException(`ops[${i}] (redline_update_comment): \`text\` must be a string`);
      }
      return { op: 'redline_update_comment', commentId: raw.commentId, title: raw.title as string | undefined, text: raw.text as string | undefined };
    }
    case 'redline_dismiss_comment': {
      if (typeof raw.commentId !== 'string' || !raw.commentId.trim()) {
        throw new BadRequestException(`ops[${i}] (redline_dismiss_comment): \`commentId\` must be a non-empty string`);
      }
      if (typeof raw.dismissed !== 'boolean') {
        throw new BadRequestException(`ops[${i}] (redline_dismiss_comment): \`dismissed\` must be a boolean`);
      }
      return { op: 'redline_dismiss_comment', commentId: raw.commentId, dismissed: raw.dismissed };
    }
    case 'redline_remove_comment': {
      if (typeof raw.commentId !== 'string' || !raw.commentId.trim()) {
        throw new BadRequestException(`ops[${i}] (redline_remove_comment): \`commentId\` must be a non-empty string`);
      }
      return { op: 'redline_remove_comment', commentId: raw.commentId };
    }
    default:
      throw new BadRequestException(`ops[${i}]: unknown op "${opName}"`);
  }
}

// Parse a `{ text }[]` list (subItems/footnotes on add_paragraph). Undefined → [].
function parseTextItems(raw: unknown, i: number, op: string, field: string): { text: string }[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new BadRequestException(`ops[${i}] (${op}): \`${field}\` must be an array`);
  }
  return raw.map((item) => {
    if (item === null || typeof item !== 'object' || typeof (item as { text: unknown }).text !== 'string') {
      throw new BadRequestException(`ops[${i}] (${op}): each \`${field}\` entry must be an object with a string \`text\``);
    }
    return { text: (item as { text: string }).text };
  });
}

// Parse a `{ id?, text }[]` list (subItems/footnotes on update_paragraph).
function parseIdTextItems(raw: unknown, i: number, op: string, field: string): { id?: string; text: string }[] {
  if (!Array.isArray(raw)) {
    throw new BadRequestException(`ops[${i}] (${op}): \`${field}\` must be an array`);
  }
  return raw.map((item) => {
    if (item === null || typeof item !== 'object' || typeof (item as { text: unknown }).text !== 'string') {
      throw new BadRequestException(`ops[${i}] (${op}): each \`${field}\` entry must be an object with a string \`text\``);
    }
    const obj = item as { id?: unknown; text: string };
    if (obj.id !== undefined && typeof obj.id !== 'string') {
      throw new BadRequestException(`ops[${i}] (${op}): \`${field}\` entry \`id\` must be a string`);
    }
    return { id: obj.id as string | undefined, text: obj.text };
  });
}

// Parse a `string[]` list (exhibitIds). Undefined → [].
function parseStringArray(raw: unknown, i: number, op: string, field: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((v): v is string => typeof v === 'string')) {
    throw new BadRequestException(`ops[${i}] (${op}): \`${field}\` must be an array of strings`);
  }
  return raw as string[];
}

function applyOp(
  type: ProductionType,
  data: Record<string, unknown>,
  op: Op,
  i: number,
  actorUserId: string,
): Record<string, unknown> {
  if (op.op.startsWith('chronology_') && type !== ProductionType.CHRONOLOGY) {
    throw new BadRequestException(`ops[${i}] (${op.op}): production is type "${type}", not "chronology"`);
  }
  if (op.op.startsWith('chart_') && type !== ProductionType.CHART) {
    throw new BadRequestException(`ops[${i}] (${op.op}): production is type "${type}", not "chart"`);
  }
  if (op.op.startsWith('declaration_') && type !== ProductionType.DECLARATION) {
    throw new BadRequestException(`ops[${i}] (${op.op}): production is type "${type}", not "declaration"`);
  }
  if (op.op.startsWith('redline_') && type !== ProductionType.REDLINE) {
    throw new BadRequestException(`ops[${i}] (${op.op}): production is type "${type}", not "redline"`);
  }
  const entries = Array.isArray(data.entries) ? [...(data.entries as ChronologyEntry[])] : [];

  switch (op.op) {
    case 'chronology_append':
      return { ...data, entries: [...entries, ...op.entries.map((e) => normalizeEntry(e))] };
    case 'chronology_replace': {
      if (op.index >= entries.length) {
        throw new BadRequestException(`ops[${i}] (chronology_replace): index ${op.index} out of bounds (length=${entries.length})`);
      }
      entries[op.index] = normalizeEntry(op.entry as Record<string, unknown>);
      return { ...data, entries };
    }
    case 'chronology_delete': {
      const sorted = [...op.indexes].sort((a, b) => b - a); // desc, so earlier indexes stay valid
      for (const idx of sorted) {
        if (idx >= entries.length) {
          throw new BadRequestException(`ops[${i}] (chronology_delete): index ${idx} out of bounds (length=${entries.length})`);
        }
        entries.splice(idx, 1);
      }
      return { ...data, entries };
    }
    case 'chronology_set_column_widths': {
      const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
      const next = columns.map((c) => ({ ...c }));
      for (const [key, width] of Object.entries(op.widths)) {
        const idx = next.findIndex((c) => c.key === key);
        if (idx < 0) {
          throw new BadRequestException(`ops[${i}] (chronology_set_column_widths): unknown column key "${key}"`);
        }
        next[idx].width = width;
      }
      const out: Record<string, unknown> = { ...data, columns: next };
      delete out.columnWidths;
      return out;
    }
    case 'chronology_set_row_highlight': {
      for (const idx of op.indexes) {
        if (idx >= entries.length) {
          throw new BadRequestException(`ops[${i}] (chronology_set_row_highlight): index ${idx} out of bounds (length=${entries.length})`);
        }
        const current = entries[idx] ?? {};
        const next = { ...current };
        if (op.color === null) delete next.highlight;
        else next.highlight = op.color;
        entries[idx] = next;
      }
      return { ...data, entries };
    }
    case 'chronology_add_column': {
      const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
      if (columns.some((c) => c.key === op.column.key)) {
        throw new BadRequestException(`ops[${i}] (chronology_add_column): duplicate column key "${op.column.key}"`);
      }
      const insertAt = op.index ?? columns.length;
      if (insertAt > columns.length) {
        throw new BadRequestException(`ops[${i}] (chronology_add_column): index ${insertAt} out of bounds (length=${columns.length})`);
      }
      columns.splice(insertAt, 0, op.column);
      return { ...data, columns };
    }
    case 'chronology_remove_column': {
      const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
      const idx = columns.findIndex((c) => c.key === op.key);
      if (idx < 0) throw new BadRequestException(`ops[${i}] (chronology_remove_column): unknown column key "${op.key}"`);
      if (columns.length <= 1) throw new BadRequestException(`ops[${i}] (chronology_remove_column): chronology must have at least one column`);
      columns.splice(idx, 1);
      return { ...data, columns };
    }
    case 'chronology_update_column': {
      const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
      const idx = columns.findIndex((c) => c.key === op.key);
      if (idx < 0) throw new BadRequestException(`ops[${i}] (chronology_update_column): unknown column key "${op.key}"`);
      columns[idx] = { ...columns[idx], ...op.patch };
      return { ...data, columns };
    }
    case 'chronology_reorder_columns': {
      const columns = Array.isArray(data.columns) ? [...(data.columns as ColumnDef[])] : [];
      const existing = new Set(columns.map((c) => c.key));
      const incoming = new Set(op.keys);
      if (existing.size !== incoming.size || [...existing].some((k) => !incoming.has(k))) {
        throw new BadRequestException(`ops[${i}] (chronology_reorder_columns): \`keys\` must include exactly the existing column keys`);
      }
      const byKey = new Map(columns.map((c) => [c.key, c]));
      return { ...data, columns: op.keys.map((k) => byKey.get(k)!) };
    }
    case 'chart_set_height':
      return { ...data, height: op.height };
    case 'declaration_set_caption': {
      const caption = { ...(data.caption as DeclarationCaption), ...op.caption };
      return { ...data, caption };
    }
    case 'declaration_set_execution': {
      const execution = { ...(data.execution as DeclarationData['execution']), ...op.execution };
      return { ...data, execution };
    }
    case 'declaration_add_section': {
      const sections = declSections(data);
      const section: DeclarationSection = { id: randomUUID(), kind: op.kind, heading: op.heading, paragraphs: [] };
      if (op.afterSectionId !== undefined) {
        const idx = sections.findIndex((s) => s.id === op.afterSectionId);
        if (idx < 0) throw new BadRequestException(`ops[${i}] (declaration_add_section): unknown section "${op.afterSectionId}"`);
        sections.splice(idx + 1, 0, section);
      } else {
        sections.push(section);
      }
      return { ...data, sections };
    }
    case 'declaration_add_paragraph': {
      const sections = declSections(data);
      const section = sections.find((s) => s.id === op.sectionId);
      if (!section) throw new BadRequestException(`ops[${i}] (declaration_add_paragraph): unknown section "${op.sectionId}"`);
      const exhibits = declExhibits(data);
      const exhibitIds = op.exhibitIds ?? [];
      for (const id of exhibitIds) {
        if (!exhibits.some((e) => e.id === id)) {
          throw new BadRequestException(`ops[${i}] (declaration_add_paragraph): unknown exhibit "${id}"`);
        }
      }
      const paragraph: DeclarationParagraph = {
        id: randomUUID(),
        text: op.text,
        subItems: (op.subItems ?? []).map((s): DeclarationSubItem => ({ id: randomUUID(), text: s.text })),
        exhibitIds,
        footnotes: (op.footnotes ?? []).map((f): DeclarationFootnote => ({ id: randomUUID(), text: f.text })),
      };
      const paragraphs = [...section.paragraphs];
      if (op.afterParagraphId !== undefined) {
        const idx = paragraphs.findIndex((p) => p.id === op.afterParagraphId);
        if (idx < 0) throw new BadRequestException(`ops[${i}] (declaration_add_paragraph): unknown paragraph "${op.afterParagraphId}"`);
        paragraphs.splice(idx + 1, 0, paragraph);
      } else {
        paragraphs.push(paragraph);
      }
      const nextSections = sections.map((s) => (s.id === section.id ? { ...s, paragraphs } : s));
      return { ...data, sections: nextSections };
    }
    case 'declaration_update_paragraph': {
      const sections = declSections(data);
      let found = false;
      const exhibits = declExhibits(data);
      if (op.exhibitIds !== undefined) {
        for (const id of op.exhibitIds) {
          if (!exhibits.some((e) => e.id === id)) {
            throw new BadRequestException(`ops[${i}] (declaration_update_paragraph): unknown exhibit "${id}"`);
          }
        }
      }
      const nextSections = sections.map((s) => ({
        ...s,
        paragraphs: s.paragraphs.map((p) => {
          if (p.id !== op.paragraphId) return p;
          found = true;
          const next: DeclarationParagraph = { ...p };
          if (op.text !== undefined) next.text = op.text;
          if (op.subItems !== undefined) {
            next.subItems = op.subItems.map((s2): DeclarationSubItem => ({ id: s2.id ?? randomUUID(), text: s2.text }));
          }
          if (op.exhibitIds !== undefined) next.exhibitIds = op.exhibitIds;
          if (op.footnotes !== undefined) {
            next.footnotes = op.footnotes.map((f): DeclarationFootnote => ({ id: f.id ?? randomUUID(), text: f.text }));
          }
          return next;
        }),
      }));
      if (!found) throw new BadRequestException(`ops[${i}] (declaration_update_paragraph): unknown paragraph "${op.paragraphId}"`);
      return { ...data, sections: nextSections };
    }
    case 'declaration_remove_paragraph': {
      const sections = declSections(data);
      let found = false;
      const nextSections = sections.map((s) => {
        const paragraphs = s.paragraphs.filter((p) => {
          if (p.id === op.paragraphId) {
            found = true;
            return false;
          }
          return true;
        });
        return paragraphs.length === s.paragraphs.length ? s : { ...s, paragraphs };
      });
      if (!found) throw new BadRequestException(`ops[${i}] (declaration_remove_paragraph): unknown paragraph "${op.paragraphId}"`);
      return { ...data, sections: nextSections };
    }
    case 'declaration_add_exhibit': {
      const exhibits = declExhibits(data);
      const label = op.label ?? nextExhibitLabel(exhibits);
      if (exhibits.some((e) => e.label === label)) {
        throw new BadRequestException(`ops[${i}] (declaration_add_exhibit): label "${label}" is already in use`);
      }
      const exhibit: DeclarationExhibit = {
        id: randomUUID(),
        label,
        description: op.description,
        source: op.source ?? null,
      };
      return { ...data, exhibits: [...exhibits, exhibit] };
    }
    case 'declaration_update_exhibit': {
      const exhibits = declExhibits(data);
      const idx = exhibits.findIndex((e) => e.id === op.exhibitId);
      if (idx < 0) throw new BadRequestException(`ops[${i}] (declaration_update_exhibit): unknown exhibit "${op.exhibitId}"`);
      if (op.label !== undefined && exhibits.some((e) => e.label === op.label && e.id !== op.exhibitId)) {
        throw new BadRequestException(`ops[${i}] (declaration_update_exhibit): label "${op.label}" is already in use`);
      }
      const next = { ...exhibits[idx] };
      if (op.label !== undefined) next.label = op.label;
      if (op.description !== undefined) next.description = op.description;
      if (op.source !== undefined) next.source = op.source;
      const nextExhibits = [...exhibits];
      nextExhibits[idx] = next;
      return { ...data, exhibits: nextExhibits };
    }
    case 'redline_add_edit': {
      const baseText = typeof data.baseText === 'string' ? data.baseText : '';
      const res = resolveAnchor(baseText, op.anchorText);
      if ('error' in res) {
        if (res.error === 'anchor_ambiguous') {
          throw new BadRequestException(
            `ops[${i}] (redline_add_edit): anchor_ambiguous — matched ${res.count} times; quote a longer span to disambiguate`,
          );
        }
        throw new BadRequestException(`ops[${i}] (redline_add_edit): ${res.error}`);
      }
      const { start, end } = res;
      const edits = redlineEdits(data);
      // Overlap gate: replace/delete edits may not overlap a live (non-rejected,
      // non-insert_after) edit. insert_after never participates — as adder or obstacle.
      if (op.kind === 'replace' || op.kind === 'delete') {
        for (const e of edits) {
          if (e.status === 'rejected' || e.kind === 'insert_after') continue;
          if (spansOverlap(start, end, e.anchor.start, e.anchor.end)) {
            throw new BadRequestException(
              `ops[${i}] (redline_add_edit): span [${start},${end}) overlaps existing edit ${e.id} [${e.anchor.start},${e.anchor.end})`,
            );
          }
        }
      }
      const edit: RedlineEdit = {
        id: randomUUID(),
        kind: op.kind,
        anchor: { text: baseText.slice(start, end), start, end },
        newText: op.newText,
        basis: op.basis,
        status: 'proposed',
        origin: op.origin === 'user' ? 'user' : 'agent',
      };
      if (op.comment !== undefined) edit.comment = op.comment;
      return { ...data, edits: [...edits, edit] };
    }
    case 'redline_update_edit': {
      const edits = redlineEdits(data);
      const idx = edits.findIndex((e) => e.id === op.editId);
      if (idx < 0) throw new BadRequestException(`ops[${i}] (redline_update_edit): unknown edit "${op.editId}"`);
      const next = { ...edits[idx] };
      if (op.status !== undefined) next.status = op.status;
      if (op.newText !== undefined) next.newText = op.newText;
      if (op.basis !== undefined) next.basis = op.basis;
      if (op.comment !== undefined) next.comment = op.comment;
      const nextEdits = [...edits];
      nextEdits[idx] = next;
      return { ...data, edits: nextEdits };
    }
    case 'redline_remove_edit': {
      const edits = redlineEdits(data);
      const idx = edits.findIndex((e) => e.id === op.editId);
      if (idx < 0) throw new BadRequestException(`ops[${i}] (redline_remove_edit): unknown edit "${op.editId}"`);
      const nextEdits = [...edits];
      nextEdits.splice(idx, 1);
      return { ...data, edits: nextEdits };
    }
    case 'redline_add_comment': {
      const comments = redlineComments(data);
      const comment: RedlineComment = { id: randomUUID(), title: op.title, text: op.text };
      return { ...data, comments: [...comments, comment] };
    }
    case 'redline_update_comment': {
      const comments = redlineComments(data);
      const idx = comments.findIndex((c) => c.id === op.commentId);
      if (idx < 0) throw new BadRequestException(`ops[${i}] (redline_update_comment): unknown comment "${op.commentId}"`);
      const next = { ...comments[idx] };
      if (op.title !== undefined) next.title = op.title;
      if (op.text !== undefined) next.text = op.text;
      const nextComments = [...comments];
      nextComments[idx] = next;
      return { ...data, comments: nextComments };
    }
    case 'redline_dismiss_comment': {
      const comments = redlineComments(data);
      const idx = comments.findIndex((c) => c.id === op.commentId);
      if (idx < 0) throw new BadRequestException(`ops[${i}] (redline_dismiss_comment): unknown comment "${op.commentId}"`);
      // Dismissal is acknowledgment, not deletion: stamp who/when (server clock),
      // or clear both to restore. The comment itself is retained for the record.
      const next = { ...comments[idx] };
      if (op.dismissed) {
        next.dismissedAt = new Date().toISOString();
        next.dismissedBy = actorUserId;
      } else {
        next.dismissedAt = null;
        next.dismissedBy = null;
      }
      const nextComments = [...comments];
      nextComments[idx] = next;
      return { ...data, comments: nextComments };
    }
    case 'redline_remove_comment': {
      const comments = redlineComments(data);
      const idx = comments.findIndex((c) => c.id === op.commentId);
      if (idx < 0) throw new BadRequestException(`ops[${i}] (redline_remove_comment): unknown comment "${op.commentId}"`);
      const nextComments = [...comments];
      nextComments.splice(idx, 1);
      return { ...data, comments: nextComments };
    }
  }
}

function declSections(data: Record<string, unknown>): DeclarationSection[] {
  return Array.isArray(data.sections) ? (data.sections as DeclarationSection[]).map((s) => ({ ...s })) : [];
}

function declExhibits(data: Record<string, unknown>): DeclarationExhibit[] {
  return Array.isArray(data.exhibits) ? [...(data.exhibits as DeclarationExhibit[])] : [];
}

function redlineEdits(data: Record<string, unknown>): RedlineEdit[] {
  return Array.isArray(data.edits) ? [...(data.edits as RedlineEdit[])] : [];
}

function redlineComments(data: Record<string, unknown>): RedlineComment[] {
  return Array.isArray(data.comments) ? [...(data.comments as RedlineComment[])] : [];
}
