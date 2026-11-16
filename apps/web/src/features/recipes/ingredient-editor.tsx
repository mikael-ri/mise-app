import type { ReactNode } from 'react';
import type { ScalePolicy } from '@mise/contracts';
import { SCALE_POLICIES } from '@mise/contracts';
import { UNIT_TABLE } from '@mise/domain';
import { Button } from '../../components/button.js';
import { Field, INPUT_CLASS, invalidProps } from '../../components/form-field.js';
import {
  Menu,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from '../../components/menu.js';
import { SortableList, SortableRow } from '../../components/sortable-list.js';
import { t } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/index.js';
import type { EditorProps } from './editor-types.js';
import {
  addGroup,
  addLine,
  deleteGroup,
  deleteLine,
  moveGroup,
  moveLine,
  moveLineToGroup,
  renameGroup,
  reorderLine,
  sections,
  updateLine,
} from './form-model.js';
import type { DraftLine, LineSection } from './form-model.js';

const UNIT_LIST_ID = 'unit-options';
/** Units offered in the picker (conventions: g, kg, ml, dl, l, tl, rkl, kpl, prk, ps); free text stays allowed. */
const KNOWN_UNITS = ['g', 'kg', 'ml', 'dl', 'l', 'tl', 'rkl', 'kpl', 'prk', 'ps'].filter((code) =>
  UNIT_TABLE.some((u) => u.code === code),
);

const SCALE_LABEL: Record<ScalePolicy, MessageKey> = {
  linear: 'recipes.form.scale.linear',
  round_to_whole: 'recipes.form.scale.roundToWhole',
  to_taste: 'recipes.form.scale.toTaste',
  not_scalable: 'recipes.form.scale.notScalable',
};

function LineRow({
  line,
  index,
  count,
  groups,
  editor,
  handle,
}: {
  line: DraftLine;
  index: number;
  count: number;
  groups: LineSection[];
  editor: EditorProps;
  handle: ReactNode;
}) {
  const { update, errorFor, touch } = editor;
  const errors = editor.errors.lines[line.id] ?? {};
  const field = (name: string) => `line-${line.id}-${name}`;
  const key = (name: string) => `line:${line.id}:${name}`;
  const nameError = errorFor(key('name'), errors.name);
  const minError = errorFor(key('amountMin'), errors.amountMin);
  const maxError = errorFor(key('amountMax'), errors.amountMax);
  const patch = (change: Partial<DraftLine>) => update((d) => updateLine(d, line.id, change));
  const displayName = line.name.trim() === '' ? t('recipes.form.line.unnamed') : line.name.trim();
  const otherGroups = groups.filter((g) => g.group !== null && g.groupId !== line.groupId);

  return (
    <div className="flex items-start gap-1">
      {handle}
      <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
        <Field
          id={field('min')}
          label={t(line.isRange ? 'recipes.form.line.min' : 'recipes.form.line.amount')}
          error={minError}
        >
          <input
            {...invalidProps(field('min'), minError)}
            className={INPUT_CLASS}
            inputMode="decimal"
            autoComplete="off"
            value={line.amountMin}
            onChange={(e) => patch({ amountMin: e.target.value })}
            onBlur={() => touch(key('amountMin'))}
          />
        </Field>
        {line.isRange ? (
          <Field id={field('max')} label={t('recipes.form.line.max')} error={maxError}>
            <input
              {...invalidProps(field('max'), maxError)}
              className={INPUT_CLASS}
              inputMode="decimal"
              autoComplete="off"
              value={line.amountMax}
              onChange={(e) => patch({ amountMax: e.target.value })}
              onBlur={() => touch(key('amountMax'))}
            />
          </Field>
        ) : (
          <div />
        )}
        <Field id={field('unit')} label={t('recipes.form.line.unit')}>
          <input
            id={field('unit')}
            className={INPUT_CLASS}
            list={UNIT_LIST_ID}
            autoComplete="off"
            value={line.unit}
            onChange={(e) => patch({ unit: e.target.value })}
          />
        </Field>
        <Field id={field('name')} label={t('recipes.form.line.name')} error={nameError}>
          <input
            {...invalidProps(field('name'), nameError)}
            className={INPUT_CLASS}
            autoComplete="off"
            value={line.name}
            onChange={(e) => patch({ name: e.target.value })}
            onBlur={() => touch(key('name'))}
          />
        </Field>
        <Field id={field('note')} label={t('recipes.form.line.note')} className="col-span-2">
          <input
            id={field('note')}
            className={INPUT_CLASS}
            autoComplete="off"
            value={line.note}
            onChange={(e) => patch({ note: e.target.value })}
          />
        </Field>
      </div>
      <Menu label={t('recipes.form.line.menu', { name: displayName })}>
        <MenuItem
          onSelect={() =>
            patch({ isRange: !line.isRange, ...(line.isRange ? { amountMax: '' } : {}) })
          }
        >
          {t(line.isRange ? 'recipes.form.line.makeSingle' : 'recipes.form.line.makeRange')}
        </MenuItem>
        <MenuItem disabled={index === 0} onSelect={() => update((d) => moveLine(d, line.id, 'up'))}>
          {t('recipes.form.moveUp')}
        </MenuItem>
        <MenuItem
          disabled={index === count - 1}
          onSelect={() => update((d) => moveLine(d, line.id, 'down'))}
        >
          {t('recipes.form.moveDown')}
        </MenuItem>
        {line.groupId !== null && (
          <MenuItem onSelect={() => update((d) => moveLineToGroup(d, line.id, null))}>
            {t('recipes.form.line.removeFromGroup')}
          </MenuItem>
        )}
        {otherGroups.map((g) => (
          <MenuItem
            key={g.groupId}
            onSelect={() => update((d) => moveLineToGroup(d, line.id, g.groupId))}
          >
            {t('recipes.form.line.moveToGroup', {
              name: g.group?.name.trim() || t('recipes.form.group.unnamed'),
            })}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>{t('recipes.form.line.scaling')}</MenuLabel>
        <MenuRadioGroup
          value={line.scalePolicy}
          onValueChange={(value) => patch({ scalePolicy: value as ScalePolicy })}
        >
          {SCALE_POLICIES.map((policy) => (
            <MenuRadioItem key={policy} value={policy}>
              {t(SCALE_LABEL[policy])}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem onSelect={() => update((d) => deleteLine(d, line.id))}>
          {t('recipes.form.delete')}
        </MenuItem>
      </Menu>
    </div>
  );
}

export function IngredientEditor(editor: EditorProps) {
  const { draft, update, errorFor, touch } = editor;
  const blocks = sections(draft).filter((s) => s.group !== null || s.lines.length > 0);
  const groupErrors = editor.errors.groups;
  const contentError = editor.errors.content;

  return (
    <section aria-labelledby="form-ingredients" className="flex flex-col gap-3">
      <h2 id="form-ingredients" className="text-lg font-semibold">
        {t('recipes.detail.ingredients')}
      </h2>
      <datalist id={UNIT_LIST_ID}>
        {KNOWN_UNITS.map((code) => (
          <option key={code} value={code} />
        ))}
      </datalist>
      {blocks.map((block) => {
        const groupIndex = draft.groups.findIndex((g) => g.id === block.groupId);
        return (
          <div key={block.groupId ?? 'ungrouped'} className="flex flex-col gap-2">
            {block.group !== null && (
              <div className="flex items-start gap-2">
                <Field
                  id={`group-${block.group.id}`}
                  label={t('recipes.form.group.label')}
                  className="flex-1"
                  error={errorFor(`group:${block.group.id}`, groupErrors[block.group.id])}
                >
                  <input
                    {...invalidProps(
                      `group-${block.group.id}`,
                      errorFor(`group:${block.group.id}`, groupErrors[block.group.id]),
                    )}
                    className={INPUT_CLASS}
                    autoComplete="off"
                    value={block.group.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      const id = block.groupId;
                      if (id !== null) update((d) => renameGroup(d, id, name));
                    }}
                    onBlur={() => touch(`group:${block.group?.id ?? ''}`)}
                  />
                </Field>
                <div className="mt-6">
                  <Menu
                    label={t('recipes.form.group.menu', {
                      name: block.group.name.trim() || t('recipes.form.group.unnamed'),
                    })}
                  >
                    <MenuItem
                      disabled={groupIndex === 0}
                      onSelect={() => update((d) => moveGroup(d, block.group?.id ?? '', 'up'))}
                    >
                      {t('recipes.form.moveUp')}
                    </MenuItem>
                    <MenuItem
                      disabled={groupIndex === draft.groups.length - 1}
                      onSelect={() => update((d) => moveGroup(d, block.group?.id ?? '', 'down'))}
                    >
                      {t('recipes.form.moveDown')}
                    </MenuItem>
                    <MenuItem onSelect={() => update((d) => deleteGroup(d, block.group?.id ?? ''))}>
                      {t('recipes.form.group.delete')}
                    </MenuItem>
                  </Menu>
                </div>
              </div>
            )}
            <SortableList
              ids={block.lines.map((l) => l.id)}
              onReorder={(a, o) => update((d) => reorderLine(d, a, o))}
            >
              <ul className="flex flex-col gap-3">
                {block.lines.map((line, index) => (
                  <SortableRow
                    key={line.id}
                    id={line.id}
                    testId="ingredient-row"
                    className="rounded-lg border border-border bg-surface p-2"
                  >
                    {(handle) => (
                      <LineRow
                        line={line}
                        index={index}
                        count={block.lines.length}
                        groups={blocks}
                        editor={editor}
                        handle={handle}
                      />
                    )}
                  </SortableRow>
                ))}
              </ul>
            </SortableList>
            {block.group !== null && (
              <div>
                <Button
                  variant="secondary"
                  onClick={() => update((d) => addLine(d, crypto.randomUUID(), block.groupId))}
                >
                  {t('recipes.form.addIngredientToGroup')}
                </Button>
              </div>
            )}
          </div>
        );
      })}
      {contentError !== undefined && errorFor('content', 'required') !== undefined && (
        <p role="alert" className="text-danger">
          <span aria-hidden="true">! </span>
          {t('recipes.form.error.empty')}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => update((d) => addLine(d, crypto.randomUUID()))}>
          {t('recipes.form.addIngredient')}
        </Button>
        <Button variant="secondary" onClick={() => update((d) => addGroup(d, crypto.randomUUID()))}>
          {t('recipes.form.addGroup')}
        </Button>
      </div>
    </section>
  );
}
