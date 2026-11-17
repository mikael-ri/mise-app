import { describe, expect, it } from 'vitest';
import {
  addGroup,
  addLine,
  addTag,
  buildContent,
  buildSubmission,
  deleteGroup,
  draftFromRecipe,
  emptyDraft,
  formatInput,
  hasErrors,
  isDirty,
  moveGroup,
  moveLine,
  moveLineToGroup,
  reorderLine,
  reorderStep,
  saveKind,
  sections,
  toRationalString,
  updateLine,
  validateDraft,
} from './form-model.js';
import { salmonRecipe, uuid } from './recipe-fixtures.js';

const recipe = salmonRecipe();
const ids = (lines: { id: string }[]) => lines.map((l) => l.id);

describe('form model: ordering and groups (FR-01, FR-05)', () => {
  it('FR-05: loading a recipe and building content again is lossless', () => {
    const rebuilt = buildContent(draftFromRecipe(recipe));
    expect(rebuilt).toEqual(recipe.content);
  });

  it('drag within a group keeps stable ids and group membership', () => {
    const draft = draftFromRecipe(recipe);
    const next = reorderLine(draft, uuid(12), uuid(11));
    const group1 = sections(next).find((s) => s.groupId === uuid(1));
    expect(ids(group1?.lines ?? [])).toEqual([uuid(12), uuid(11)]);
    expect(next.lines.map((l) => [l.id, l.groupId])).toEqual([
      [uuid(12), uuid(1)],
      [uuid(11), uuid(1)],
      [uuid(13), uuid(2)],
      [uuid(14), uuid(2)],
      [uuid(15), uuid(2)],
    ]);
  });

  it('drag onto a line of another group changes nothing', () => {
    const draft = draftFromRecipe(recipe);
    expect(reorderLine(draft, uuid(11), uuid(13))).toEqual(draft);
  });

  it.each([
    ['up', uuid(12), [uuid(12), uuid(11)]],
    ['down', uuid(11), [uuid(12), uuid(11)]],
  ] as const)('row menu move %s stays inside the group', (direction, lineId, expected) => {
    const next = moveLine(draftFromRecipe(recipe), lineId, direction);
    expect(ids(sections(next)[1]?.lines ?? [])).toEqual(expected);
  });

  it('row menu move is a no-op at the edge of a group', () => {
    const draft = draftFromRecipe(recipe);
    expect(moveLine(draft, uuid(11), 'up')).toEqual(draft);
    expect(moveLine(draft, uuid(12), 'down')).toEqual(draft);
  });

  it('moving a line to another group appends it there and keeps its id', () => {
    const next = moveLineToGroup(draftFromRecipe(recipe), uuid(11), uuid(2));
    const group2 = sections(next).find((s) => s.groupId === uuid(2));
    expect(ids(group2?.lines ?? [])).toEqual([uuid(13), uuid(14), uuid(15), uuid(11)]);
    expect(next.lines.find((l) => l.id === uuid(11))?.groupId).toBe(uuid(2));
    expect(moveLineToGroup(next, uuid(11), uuid(999))).toEqual(next);
  });

  it('deleting a group keeps its lines as ungrouped', () => {
    const next = deleteGroup(draftFromRecipe(recipe), uuid(1));
    expect(next.groups.map((g) => g.id)).toEqual([uuid(2)]);
    expect(ids(sections(next)[0]?.lines ?? [])).toEqual([uuid(11), uuid(12)]);
  });

  it('reorders groups and steps with stable ids; group order is renumbered', () => {
    const next = moveGroup(draftFromRecipe(recipe), uuid(2), 'up');
    expect(buildContent(next).ingredient_groups).toEqual([
      { id: uuid(2), name: 'Kastike', order: 1 },
      { id: uuid(1), name: 'Kala', order: 2 },
    ]);
    const steps = reorderStep(draftFromRecipe(recipe), uuid(22), uuid(21));
    expect(buildContent(steps).instructions.map((s) => [s.id, s.order])).toEqual([
      [uuid(22), 1],
      [uuid(21), 2],
    ]);
  });
});

describe('form model: quantities are never rewritten (FR-05, hard rule 3)', () => {
  it('shows decimals with a Finnish comma and converts typed text back to exact strings', () => {
    expect(formatInput('1.5')).toBe('1,5');
    expect(formatInput('1/2')).toBe('1/2');
    expect(toRationalString('1,5')).toBe('1.5');
    expect(toRationalString('007')).toBe('7');
    expect(toRationalString('1 1/2')).toBe('3/2');
    expect(toRationalString('maun mukaan')).toBeNull();
  });

  it('keeps the original text, unit and unit code of lines the user did not touch', () => {
    const edited = updateLine(draftFromRecipe(recipe), uuid(13), { note: 'huoneenlämpöistä' });
    const line = buildContent(edited).ingredients.find((l) => l.id === uuid(13));
    expect(line).toMatchObject({
      original_quantity_text: '1,5 dl',
      amount_min: '1.5',
      original_unit: 'dl',
      preparation_note: 'huoneenlämpöistä',
    });
  });

  it('stores an edited amount as typed, a range as a range, and vague text as entered', () => {
    let draft = draftFromRecipe(recipe);
    draft = updateLine(draft, uuid(11), { amountMin: '0,5' });
    draft = updateLine(draft, uuid(14), { amountMin: '2', amountMax: '3' });
    draft = updateLine(draft, uuid(12), { amountMin: 'maun mukaan', unit: '' });
    const lines = buildContent(draft).ingredients;
    expect(lines.find((l) => l.id === uuid(11))).toMatchObject({
      original_quantity_text: '0,5 g',
      amount_min: '0.5',
      amount_max: '0.5',
      canonical_unit_code: 'g',
    });
    expect(lines.find((l) => l.id === uuid(14))).toMatchObject({
      original_quantity_text: '2-3 kpl',
      amount_min: '2',
      amount_max: '3',
    });
    expect(lines.find((l) => l.id === uuid(12))).toMatchObject({
      original_quantity_text: 'maun mukaan',
      amount_min: null,
      amount_max: null,
    });
  });

  it('keeps a free-text unit as entered and invents no unit code', () => {
    const draft = updateLine(draftFromRecipe(recipe), uuid(11), { unit: 'nippu isoa' });
    const line = buildContent(draft).ingredients.find((l) => l.id === uuid(11));
    expect(line).toMatchObject({ original_unit: 'nippu isoa', canonical_unit_code: null });
  });
});

describe('form model: validation, dirty detection, submission (FR-01, FR-03)', () => {
  it('validates title, yield, times, source, ranges and the empty recipe', () => {
    const base = emptyDraft({ lineId: uuid(1), stepId: uuid(2) });
    const errors = validateDraft({
      ...base,
      yieldQuantity: '0',
      prepMinutes: '-1',
      sourceUrl: 'ftp://x',
    });
    expect(errors).toMatchObject({
      title: 'required',
      yieldQuantity: 'positive',
      prepMinutes: 'whole_number',
      sourceUrl: 'url',
      content: 'empty',
    });
    const range = updateLine(draftFromRecipe(recipe), uuid(14), { amountMin: '3', amountMax: '2' });
    expect(validateDraft(range).lines[uuid(14)]).toEqual({ amountMax: 'range_order' });
    expect(hasErrors(validateDraft(draftFromRecipe(recipe)))).toBe(false);
  });

  it('FR-01: an empty yield is allowed and saved as null; a loaded null yield stays empty', () => {
    const empty = { ...draftFromRecipe(recipe), yieldQuantity: '', yieldSource: null };
    expect(validateDraft(empty).yieldQuantity).toBeUndefined();
    expect(buildContent(empty).yield).toBeNull();
    const loaded = draftFromRecipe({ ...recipe, content: { ...recipe.content, yield: null } });
    expect(loaded.yieldQuantity).toBe('');
    expect(buildContent(loaded).yield).toBeNull();
  });

  it('a named line without a name is flagged, a fully blank new row is ignored', () => {
    const draft = addLine(draftFromRecipe(recipe), uuid(50));
    expect(hasErrors(validateDraft(draft))).toBe(false);
    expect(buildContent(draft).ingredients).toHaveLength(5);
    const cleared = updateLine(draftFromRecipe(recipe), uuid(11), { name: '' });
    expect(validateDraft(cleared).lines[uuid(11)]).toEqual({ name: 'required' });
  });

  it('FR-03: Save vs Save new version vs Create recipe', () => {
    const draft = draftFromRecipe(recipe);
    expect(saveKind(emptyDraft({ lineId: uuid(1), stepId: uuid(2) }), null)).toBe('create');
    expect(saveKind(draft, recipe)).toBe('save');
    expect(saveKind(addTag(draft, 'uuni'), recipe)).toBe('save');
    expect(saveKind({ ...draft, generalNotes: 'uusi' }, recipe)).toBe('save');
    expect(saveKind(updateLine(draft, uuid(11), { amountMin: '400' }), recipe)).toBe('new_version');
    expect(saveKind({ ...draft, yieldQuantity: '6' }, recipe)).toBe('new_version');
    expect(saveKind(reorderLine(draft, uuid(12), uuid(11)), recipe)).toBe('new_version');
  });

  it('dirty detection ignores blank rows and whitespace but sees real edits', () => {
    const initial = draftFromRecipe(recipe);
    expect(isDirty(addLine(initial, uuid(50)), initial)).toBe(false);
    expect(isDirty({ ...initial, title: '  Uunilohi ja perunat ' }, initial)).toBe(false);
    expect(isDirty({ ...initial, title: 'Uunilohi' }, initial)).toBe(true);
    expect(isDirty(addGroup(initial, uuid(60)), initial)).toBe(true);
  });

  it('patch carries only what changed; metadata-only edits send no content', () => {
    const draft = draftFromRecipe(recipe);
    const meta = buildSubmission(addTag({ ...draft, generalNotes: '' }, 'uuni'), recipe);
    expect(meta).toEqual({
      kind: 'patch',
      newVersion: false,
      body: { tags: ['kala', 'arki', 'uuni'], generalNotes: null },
    });
    const content = buildSubmission(
      { ...updateLine(draft, uuid(11), { amountMin: '400' }), changeReason: ' vähemmän kalaa ' },
      recipe,
    );
    expect(content).toMatchObject({
      kind: 'patch',
      newVersion: true,
      body: { changeReason: 'vähemmän kalaa' },
    });
    expect(buildSubmission(draft, recipe)).toEqual({ kind: 'noop' });
  });

  it('create body has title, content and no empty optional fields', () => {
    const draft = {
      ...emptyDraft({ lineId: uuid(1), stepId: uuid(2) }),
      title: 'Kasvissosekeitto',
      yieldQuantity: '4',
    };
    const filled = updateLine(draft, uuid(1), { name: 'porkkanaa', amountMin: '3', unit: 'kpl' });
    const result = buildSubmission(filled, null);
    expect(result.kind).toBe('create');
    if (result.kind === 'create') {
      expect(Object.keys(result.body).sort()).toEqual(['content', 'title']);
      expect(result.body.content.ingredients[0]).toMatchObject({
        display_name: 'porkkanaa',
        original_quantity_text: '3 kpl',
        amount_min: '3',
      });
    }
  });
});
