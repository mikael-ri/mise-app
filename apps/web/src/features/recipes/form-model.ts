import { CreateRecipeRequest, PatchRecipeRequest } from '@mise/contracts';
import type { Recipe, RecipeContentV1, ScalePolicy } from '@mise/contracts';
import { compare, lookupUnit, normalizeKey, parseRational, rational } from '@mise/domain';

/**
 * Pure form model for the recipe editor (FR-01, FR-03, FR-05). No React, no I/O.
 * - Lines, groups and steps keep stable ids through every reorder and move.
 * - Quantities stay text while editing; untouched lines are emitted verbatim from their source line,
 *   so units and original text are never rewritten and nothing is invented (hard rule 3).
 * - Order model: ungrouped lines first, then each group (in group order) with its own lines.
 */

type IngredientLine = RecipeContentV1['ingredients'][number];

export interface DraftGroup {
  id: string;
  name: string;
}

export interface DraftLine {
  id: string;
  groupId: string | null;
  name: string;
  /** Amount text as typed, or vague text such as "maun mukaan". */
  amountMin: string;
  amountMax: string;
  isRange: boolean;
  unit: string;
  note: string;
  scalePolicy: ScalePolicy;
  /** The saved line this row came from; carries fields the form does not edit. */
  source: IngredientLine | null;
}

export interface DraftStep {
  id: string;
  text: string;
}

export interface RecipeDraft {
  title: string;
  sourceUrl: string;
  tags: string[];
  generalNotes: string;
  yieldQuantity: string;
  /** Saved yield quantity (rational string) the text field started from; kept when untouched. */
  yieldSource: string | null;
  yieldUnit: string;
  prepMinutes: string;
  cookMinutes: string;
  groups: DraftGroup[];
  lines: DraftLine[];
  steps: DraftStep[];
  changeReason: string;
}

export type Direction = 'up' | 'down';

// ---------------------------------------------------------------------------------------------
// Number text <-> rational strings
// ---------------------------------------------------------------------------------------------

const DECIMAL = /^(\d+)(?:[.,](\d+))?$/;

/** Rational string -> text for an input: Finnish decimal comma, fractions as is. */
export function formatInput(value: string): string {
  return /^\d+\.\d+$/.test(value) ? value.replace('.', ',') : value;
}

/** Typed text ("1,5", "1/2", "1 1/2") -> contract RationalString, or null when not a plain number. */
export function toRationalString(text: string): string | null {
  const s = text.trim();
  const dec = DECIMAL.exec(s);
  if (dec) {
    const whole = BigInt(dec[1] ?? '0').toString();
    return dec[2] === undefined ? whole : `${whole}.${dec[2]}`;
  }
  const parsed = parseRational(s);
  if (parsed === null) return null;
  return parsed.d === 1n ? `${parsed.n}` : `${parsed.n}/${parsed.d}`;
}

const sameNumber = (a: string, b: string): boolean => {
  const x = parseRational(a);
  const y = parseRational(b);
  return x !== null && y !== null && compare(x, y) === 0;
};

// ---------------------------------------------------------------------------------------------
// Draft construction
// ---------------------------------------------------------------------------------------------

interface QuantityFields {
  amountMin: string;
  amountMax: string;
  isRange: boolean;
  unit: string;
}

function quantityFields(line: IngredientLine): QuantityFields {
  const unit = line.original_unit ?? '';
  if (line.amount_min === null) {
    return { amountMin: line.original_quantity_text ?? '', amountMax: '', isRange: false, unit };
  }
  const max = line.amount_max;
  const isRange = max !== null && !sameNumber(max, line.amount_min);
  return {
    amountMin: formatInput(line.amount_min),
    amountMax: isRange && max !== null ? formatInput(max) : '',
    isRange,
    unit,
  };
}

function lineFromSource(source: IngredientLine): DraftLine {
  return {
    id: source.id,
    groupId: source.group_id,
    name: source.display_name,
    ...quantityFields(source),
    note: source.preparation_note ?? '',
    scalePolicy: source.scale_policy,
    source,
  };
}

export function draftFromRecipe(recipe: Recipe): RecipeDraft {
  const { content } = recipe;
  const byOrder = <T extends { order: number }>(items: readonly T[]) =>
    [...items].sort((a, b) => a.order - b.order);
  const groups = byOrder(content.ingredient_groups).map((g) => ({ id: g.id, name: g.name }));
  return sectioned({
    title: recipe.title,
    sourceUrl: recipe.sourceUrl ?? '',
    tags: [...recipe.tags],
    generalNotes: recipe.generalNotes ?? '',
    yieldQuantity: content.yield === null ? '' : formatInput(content.yield.quantity),
    yieldSource: content.yield?.quantity ?? null,
    yieldUnit: content.yield?.unit ?? 'servings',
    prepMinutes: content.prep_minutes === null ? '' : String(content.prep_minutes),
    cookMinutes: content.cook_minutes === null ? '' : String(content.cook_minutes),
    groups,
    lines: content.ingredients.map(lineFromSource),
    steps: byOrder(content.instructions).map((s) => ({ id: s.id, text: s.text })),
    changeReason: '',
  });
}

export function blankLine(id: string, groupId: string | null = null): DraftLine {
  return {
    id,
    groupId,
    name: '',
    amountMin: '',
    amountMax: '',
    isRange: false,
    unit: '',
    note: '',
    scalePolicy: 'linear',
    source: null,
  };
}

export function emptyDraft(ids: { lineId: string; stepId: string }): RecipeDraft {
  return {
    title: '',
    sourceUrl: '',
    tags: [],
    generalNotes: '',
    yieldQuantity: '',
    yieldSource: null,
    yieldUnit: 'servings',
    prepMinutes: '',
    cookMinutes: '',
    groups: [],
    lines: [blankLine(ids.lineId)],
    steps: [{ id: ids.stepId, text: '' }],
    changeReason: '',
  };
}

// ---------------------------------------------------------------------------------------------
// Sections and reordering (stable ids, group membership preserved)
// ---------------------------------------------------------------------------------------------

export interface LineSection {
  groupId: string | null;
  group: DraftGroup | null;
  lines: DraftLine[];
}

/** Ungrouped lines first, then each group in order. Lines pointing at a missing group count as ungrouped. */
export function sections(draft: RecipeDraft): LineSection[] {
  const known = new Set(draft.groups.map((g) => g.id));
  const inGroup = (id: string | null) =>
    draft.lines.filter(
      (l) => (l.groupId !== null && known.has(l.groupId) ? l.groupId : null) === id,
    );
  return [
    { groupId: null, group: null, lines: inGroup(null) },
    ...draft.groups.map((g) => ({ groupId: g.id, group: g, lines: inGroup(g.id) })),
  ];
}

/** Rewrites `lines` into canonical section order. */
function sectioned(draft: RecipeDraft): RecipeDraft {
  const known = new Set(draft.groups.map((g) => g.id));
  const lines = sections(draft).flatMap((s) =>
    s.lines.map((l) => (l.groupId !== null && !known.has(l.groupId) ? { ...l, groupId: null } : l)),
  );
  return { ...draft, lines };
}

export function arrayMove<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || to < 0 || from >= next.length || to >= next.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  if (moved !== undefined) next.splice(to, 0, moved);
  return next;
}

const target = (index: number, direction: Direction): number =>
  direction === 'up' ? index - 1 : index + 1;

function withSection(draft: RecipeDraft, groupId: string | null, lines: DraftLine[]): RecipeDraft {
  const rest = sections(draft).map((s) => (s.groupId === groupId ? { ...s, lines } : s));
  return { ...draft, lines: rest.flatMap((s) => s.lines) };
}

function sectionOf(draft: RecipeDraft, lineId: string): LineSection | undefined {
  return sections(draft).find((s) => s.lines.some((l) => l.id === lineId));
}

/** Row-menu up/down; stays inside the line's group. No-op at the section edge. */
export function moveLine(draft: RecipeDraft, lineId: string, direction: Direction): RecipeDraft {
  const section = sectionOf(draft, lineId);
  if (section === undefined) return draft;
  const from = section.lines.findIndex((l) => l.id === lineId);
  return withSection(
    draft,
    section.groupId,
    arrayMove(section.lines, from, target(from, direction)),
  );
}

/** Drag and drop: both lines must be in the same group, otherwise nothing changes. */
export function reorderLine(draft: RecipeDraft, activeId: string, overId: string): RecipeDraft {
  const section = sectionOf(draft, activeId);
  if (section === undefined) return draft;
  const from = section.lines.findIndex((l) => l.id === activeId);
  const to = section.lines.findIndex((l) => l.id === overId);
  if (to === -1) return draft;
  return withSection(draft, section.groupId, arrayMove(section.lines, from, to));
}

/** Moving to another group is a menu action; the line is appended to the target group. */
export function moveLineToGroup(
  draft: RecipeDraft,
  lineId: string,
  groupId: string | null,
): RecipeDraft {
  if (groupId !== null && !draft.groups.some((g) => g.id === groupId)) return draft;
  const line = draft.lines.find((l) => l.id === lineId);
  if (line === undefined || line.groupId === groupId) return draft;
  const others = draft.lines.filter((l) => l.id !== lineId);
  return sectioned({ ...draft, lines: [...others, { ...line, groupId }] });
}

export function moveGroup(draft: RecipeDraft, groupId: string, direction: Direction): RecipeDraft {
  const from = draft.groups.findIndex((g) => g.id === groupId);
  return sectioned({ ...draft, groups: arrayMove(draft.groups, from, target(from, direction)) });
}

export function moveStep(draft: RecipeDraft, stepId: string, direction: Direction): RecipeDraft {
  const from = draft.steps.findIndex((s) => s.id === stepId);
  return { ...draft, steps: arrayMove(draft.steps, from, target(from, direction)) };
}

export function reorderStep(draft: RecipeDraft, activeId: string, overId: string): RecipeDraft {
  const from = draft.steps.findIndex((s) => s.id === activeId);
  const to = draft.steps.findIndex((s) => s.id === overId);
  if (from === -1 || to === -1) return draft;
  return { ...draft, steps: arrayMove(draft.steps, from, to) };
}

// ---------------------------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------------------------

export function addLine(
  draft: RecipeDraft,
  id: string,
  groupId: string | null = null,
): RecipeDraft {
  return sectioned({ ...draft, lines: [...draft.lines, blankLine(id, groupId)] });
}

export function addGroup(draft: RecipeDraft, id: string): RecipeDraft {
  return { ...draft, groups: [...draft.groups, { id, name: '' }] };
}

export function updateLine(
  draft: RecipeDraft,
  lineId: string,
  patch: Partial<Omit<DraftLine, 'id' | 'groupId' | 'source'>>,
): RecipeDraft {
  return { ...draft, lines: draft.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) };
}

export function deleteLine(draft: RecipeDraft, lineId: string): RecipeDraft {
  return { ...draft, lines: draft.lines.filter((l) => l.id !== lineId) };
}

/** Deleting a group keeps its lines: they become ungrouped. */
export function deleteGroup(draft: RecipeDraft, groupId: string): RecipeDraft {
  return sectioned({
    ...draft,
    groups: draft.groups.filter((g) => g.id !== groupId),
    lines: draft.lines.map((l) => (l.groupId === groupId ? { ...l, groupId: null } : l)),
  });
}

export function renameGroup(draft: RecipeDraft, groupId: string, name: string): RecipeDraft {
  return { ...draft, groups: draft.groups.map((g) => (g.id === groupId ? { ...g, name } : g)) };
}

export function addStep(draft: RecipeDraft, id: string): RecipeDraft {
  return { ...draft, steps: [...draft.steps, { id, text: '' }] };
}

export function updateStep(draft: RecipeDraft, stepId: string, text: string): RecipeDraft {
  return { ...draft, steps: draft.steps.map((s) => (s.id === stepId ? { ...s, text } : s)) };
}

export function deleteStep(draft: RecipeDraft, stepId: string): RecipeDraft {
  return { ...draft, steps: draft.steps.filter((s) => s.id !== stepId) };
}

/** Adds a tag; ignores blanks and case-insensitive duplicates. Tags are kept as typed. */
export function addTag(draft: RecipeDraft, raw: string): RecipeDraft {
  const tag = raw.trim();
  if (tag === '' || draft.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return draft;
  return { ...draft, tags: [...draft.tags, tag] };
}

export function removeTag(draft: RecipeDraft, tag: string): RecipeDraft {
  return { ...draft, tags: draft.tags.filter((t) => t !== tag) };
}

// ---------------------------------------------------------------------------------------------
// Draft -> contract content
// ---------------------------------------------------------------------------------------------

const isBlankLine = (l: DraftLine): boolean =>
  l.source === null &&
  [l.name, l.amountMin, l.amountMax, l.unit, l.note].every((v) => v.trim() === '');

const isBlankStep = (s: DraftStep): boolean => s.text.trim() === '';

const quantityTouched = (line: DraftLine, source: IngredientLine): boolean => {
  const base = quantityFields(source);
  return (
    line.amountMin.trim() !== base.amountMin.trim() ||
    line.amountMax.trim() !== base.amountMax.trim() ||
    line.isRange !== base.isRange ||
    line.unit.trim() !== base.unit.trim()
  );
};

type QuantityPart = Pick<
  IngredientLine,
  'original_quantity_text' | 'amount_min' | 'amount_max' | 'original_unit' | 'canonical_unit_code'
>;

function buildQuantity(line: DraftLine): QuantityPart {
  const { source } = line;
  if (source !== null && !quantityTouched(line, source)) {
    return {
      original_quantity_text: source.original_quantity_text,
      amount_min: source.amount_min,
      amount_max: source.amount_max,
      original_unit: source.original_unit,
      canonical_unit_code: source.canonical_unit_code,
    };
  }
  const unit = line.unit.trim();
  const unitPart = {
    original_unit: unit === '' ? null : unit,
    canonical_unit_code: unit === '' ? null : (lookupUnit(unit)?.code ?? null),
  };
  const min = line.amountMin.trim();
  if (min === '') {
    return { original_quantity_text: null, amount_min: null, amount_max: null, ...unitPart };
  }
  const minValue = toRationalString(min);
  if (minValue === null) {
    // Vague amount ("maun mukaan"): stored as entered, never scaled.
    return { original_quantity_text: min, amount_min: null, amount_max: null, ...unitPart };
  }
  const suffix = unit === '' ? '' : ` ${unit}`;
  if (line.isRange) {
    const maxText = line.amountMax.trim();
    const maxValue = toRationalString(maxText) ?? minValue;
    return {
      original_quantity_text: `${min}-${maxText}${suffix}`,
      amount_min: minValue,
      amount_max: maxValue,
      ...unitPart,
    };
  }
  return {
    original_quantity_text: `${min}${suffix}`,
    amount_min: minValue,
    amount_max: minValue,
    ...unitPart,
  };
}

function buildLine(line: DraftLine): IngredientLine {
  const { source } = line;
  const name = line.name.trim();
  const keepKey = source !== null && source.display_name === name;
  return {
    id: line.id,
    group_id: line.groupId,
    display_name: name,
    normalized_key: keepKey ? source.normalized_key : normalizeKey(name),
    ...buildQuantity(line),
    preparation_note: line.note.trim() === '' ? null : line.note.trim(),
    scale_policy: line.scalePolicy,
    alternatives: source?.alternatives ?? [],
    uncertainties: source?.uncertainties ?? [],
  };
}

const minutes = (text: string): number | null => {
  const s = text.trim();
  return /^\d+$/.test(s) ? Number(s) : null;
};

/** Total function: invalid input yields content that `validateDraft` flags or Zod rejects. */
export function buildContent(draft: RecipeDraft): RecipeContentV1 {
  const ordered = sectioned(draft);
  const yieldText = draft.yieldQuantity.trim();
  const quantity =
    draft.yieldSource !== null && yieldText === formatInput(draft.yieldSource)
      ? draft.yieldSource
      : (toRationalString(yieldText) ?? yieldText);
  return {
    schema_version: 1,
    // An empty yield field means "servings not set" (null), never a made-up number.
    yield: yieldText === '' ? null : { quantity, unit: draft.yieldUnit.trim() },
    prep_minutes: minutes(draft.prepMinutes),
    cook_minutes: minutes(draft.cookMinutes),
    ingredient_groups: ordered.groups.map((g, i) => ({
      id: g.id,
      name: g.name.trim(),
      order: i + 1,
    })),
    ingredients: ordered.lines.filter((l) => !isBlankLine(l)).map(buildLine),
    instructions: ordered.steps
      .filter((s) => !isBlankStep(s))
      .map((s, i) => ({ id: s.id, order: i + 1, text: s.text.trim() })),
  };
}

// ---------------------------------------------------------------------------------------------
// Validation (inline messages next to the field; codes map to i18n keys in the UI)
// ---------------------------------------------------------------------------------------------

export type FieldError =
  'required' | 'positive' | 'whole_number' | 'url' | 'number' | 'range_order';

export interface DraftErrors {
  title?: FieldError;
  yieldQuantity?: FieldError;
  prepMinutes?: FieldError;
  cookMinutes?: FieldError;
  sourceUrl?: FieldError;
  /** Needs at least one ingredient or step (A09). */
  content?: 'empty';
  groups: Record<string, FieldError>;
  lines: Record<string, { name?: FieldError; amountMin?: FieldError; amountMax?: FieldError }>;
}

export const hasErrors = (e: DraftErrors): boolean =>
  e.title !== undefined ||
  e.yieldQuantity !== undefined ||
  e.prepMinutes !== undefined ||
  e.cookMinutes !== undefined ||
  e.sourceUrl !== undefined ||
  e.content !== undefined ||
  Object.keys(e.groups).length > 0 ||
  Object.keys(e.lines).length > 0;

const isHttpUrl = (text: string): boolean => {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

function minutesError(text: string): FieldError | undefined {
  const s = text.trim();
  if (s === '') return undefined;
  return /^\d{1,5}$/.test(s) && Number(s) <= 10_000 ? undefined : 'whole_number';
}

export function validateDraft(draft: RecipeDraft): DraftErrors {
  const errors: DraftErrors = { groups: {}, lines: {} };
  if (draft.title.trim() === '') errors.title = 'required';
  const yieldText = draft.yieldQuantity.trim();
  if (yieldText !== '') {
    const value = toRationalString(yieldText);
    const parsed = value === null ? null : parseRational(value);
    if (parsed === null || compare(parsed, rational(0n)) <= 0) errors.yieldQuantity = 'positive';
  }
  const prep = minutesError(draft.prepMinutes);
  if (prep !== undefined) errors.prepMinutes = prep;
  const cook = minutesError(draft.cookMinutes);
  if (cook !== undefined) errors.cookMinutes = cook;
  const url = draft.sourceUrl.trim();
  if (url !== '' && !isHttpUrl(url)) errors.sourceUrl = 'url';

  for (const g of draft.groups) {
    if (g.name.trim() === '') errors.groups[g.id] = 'required';
  }
  const kept = draft.lines.filter((l) => !isBlankLine(l));
  for (const l of kept) {
    const e: DraftErrors['lines'][string] = {};
    if (l.name.trim() === '') e.name = 'required';
    if (l.isRange) {
      const min = toRationalString(l.amountMin);
      const max = toRationalString(l.amountMax);
      if (min === null) e.amountMin = l.amountMin.trim() === '' ? 'required' : 'number';
      if (max === null) e.amountMax = l.amountMax.trim() === '' ? 'required' : 'number';
      if (min !== null && max !== null && !e.amountMax) {
        const a = parseRational(min);
        const b = parseRational(max);
        if (a !== null && b !== null && compare(a, b) > 0) e.amountMax = 'range_order';
      }
    }
    if (Object.keys(e).length > 0) errors.lines[l.id] = e;
  }
  if (kept.length === 0 && draft.steps.every(isBlankStep)) errors.content = 'empty';
  return errors;
}

// ---------------------------------------------------------------------------------------------
// Change detection and submission
// ---------------------------------------------------------------------------------------------

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Cooking content (ingredients, steps, yield, times) differs from the baseline: needs a new version. */
export function isContentChanged(draft: RecipeDraft, baseline: Recipe): boolean {
  return !same(buildContent(draft), buildContent(draftFromRecipe(baseline)));
}

/** Unsaved edits relative to the draft the form started from. */
export function isDirty(draft: RecipeDraft, initial: RecipeDraft): boolean {
  const snap = (d: RecipeDraft) => [
    d.title.trim(),
    d.sourceUrl.trim(),
    d.tags,
    d.generalNotes.trim(),
    buildContent(d),
    d.changeReason.trim(),
  ];
  return !same(snap(draft), snap(initial));
}

export type SaveKind = 'create' | 'new_version' | 'save';

/** Button label kind: Create recipe / Save new version / Save (R3). */
export function saveKind(draft: RecipeDraft, baseline: Recipe | null): SaveKind {
  if (baseline === null) return 'create';
  return isContentChanged(draft, baseline) ? 'new_version' : 'save';
}

export type Submission =
  | { kind: 'create'; body: CreateRecipeRequest }
  | { kind: 'patch'; body: PatchRecipeRequest; newVersion: boolean }
  | { kind: 'noop' }
  | { kind: 'invalid' };

/** Builds the request body from a valid draft; the contract schemas are the final gate. */
export function buildSubmission(draft: RecipeDraft, baseline: Recipe | null): Submission {
  const content = buildContent(draft);
  const title = draft.title.trim();
  const notes = draft.generalNotes.trim();
  const url = draft.sourceUrl.trim();

  if (baseline === null) {
    const body = CreateRecipeRequest.safeParse({
      title,
      ...(draft.tags.length > 0 ? { tags: draft.tags } : {}),
      ...(notes === '' ? {} : { generalNotes: notes }),
      ...(url === '' ? {} : { sourceUrl: url }),
      content,
    });
    return body.success ? { kind: 'create', body: body.data } : { kind: 'invalid' };
  }

  const patch: Record<string, unknown> = {};
  if (title !== baseline.title) patch.title = title;
  if (!same(draft.tags, baseline.tags)) patch.tags = draft.tags;
  if (notes !== (baseline.generalNotes ?? '')) patch.generalNotes = notes === '' ? null : notes;
  if (url !== (baseline.sourceUrl ?? '')) patch.sourceUrl = url === '' ? null : url;
  const newVersion = isContentChanged(draft, baseline);
  if (newVersion) {
    patch.content = content;
    const reason = draft.changeReason.trim();
    if (reason !== '') patch.changeReason = reason;
  }
  if (Object.keys(patch).length === 0) return { kind: 'noop' };
  const body = PatchRecipeRequest.safeParse(patch);
  return body.success ? { kind: 'patch', body: body.data, newVersion } : { kind: 'invalid' };
}
