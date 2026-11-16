import { Button } from '../../components/button.js';
import { Field, INPUT_CLASS } from '../../components/form-field.js';
import { Menu, MenuItem } from '../../components/menu.js';
import { SortableList, SortableRow } from '../../components/sortable-list.js';
import { t } from '../../i18n/index.js';
import type { EditorProps } from './editor-types.js';
import { addStep, deleteStep, moveStep, reorderStep, updateStep } from './form-model.js';

export function StepsEditor({ draft, update }: EditorProps) {
  const count = draft.steps.length;
  return (
    <section aria-labelledby="form-directions" className="flex flex-col gap-3">
      <h2 id="form-directions" className="text-lg font-semibold">
        {t('recipes.detail.directions')}
      </h2>
      <SortableList
        ids={draft.steps.map((s) => s.id)}
        onReorder={(a, o) => update((d) => reorderStep(d, a, o))}
      >
        <ol className="flex flex-col gap-3">
          {draft.steps.map((step, index) => (
            <SortableRow
              key={step.id}
              id={step.id}
              testId="step-row"
              className="rounded-lg border border-border bg-surface p-2"
            >
              {(handle) => (
                <div className="flex items-start gap-1">
                  {handle}
                  <Field
                    id={`step-${step.id}`}
                    label={t('recipes.form.step.label', { number: index + 1 })}
                    className="flex-1"
                  >
                    <textarea
                      id={`step-${step.id}`}
                      rows={2}
                      className={INPUT_CLASS}
                      value={step.text}
                      onChange={(e) => update((d) => updateStep(d, step.id, e.target.value))}
                    />
                  </Field>
                  <div className="mt-6">
                    <Menu label={t('recipes.form.step.menu', { number: index + 1 })}>
                      <MenuItem
                        disabled={index === 0}
                        onSelect={() => update((d) => moveStep(d, step.id, 'up'))}
                      >
                        {t('recipes.form.moveUp')}
                      </MenuItem>
                      <MenuItem
                        disabled={index === count - 1}
                        onSelect={() => update((d) => moveStep(d, step.id, 'down'))}
                      >
                        {t('recipes.form.moveDown')}
                      </MenuItem>
                      <MenuItem onSelect={() => update((d) => deleteStep(d, step.id))}>
                        {t('recipes.form.delete')}
                      </MenuItem>
                    </Menu>
                  </div>
                </div>
              )}
            </SortableRow>
          ))}
        </ol>
      </SortableList>
      <div>
        <Button variant="secondary" onClick={() => update((d) => addStep(d, crypto.randomUUID()))}>
          {t('recipes.form.addStep')}
        </Button>
      </div>
    </section>
  );
}
