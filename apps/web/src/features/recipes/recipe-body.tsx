import type { RecipeContentV1 } from '@mise/contracts';
import { ONE, compare } from '@mise/domain';
import type { Rational } from '@mise/domain';
import { useMemo, useState } from 'react';
import { Button } from '../../components/button.js';
import { t } from '../../i18n/index.js';
import {
  formatServings,
  isPreview,
  lineView,
  parseTarget,
  parseYield,
  stepTarget,
} from './scaling-view.js';
import type { LineView } from './scaling-view.js';

const INPUT = 'min-h-11 rounded-lg border border-border bg-surface px-3 text-base text-text';

export function yieldLabel(unit: string): string {
  return unit === 'servings' ? t('recipes.yield.servings') : unit;
}

function ServingsConverter({
  base,
  unit,
  target,
  onTarget,
}: {
  base: Rational;
  unit: string;
  target: Rational;
  onTarget: (value: Rational) => void;
}) {
  const [text, setText] = useState(() => formatServings(target));
  const invalid = parseTarget(text) === null;
  const preview = isPreview(base, target);

  const apply = (value: Rational) => {
    onTarget(value);
    setText(formatServings(value));
  };

  return (
    <section aria-labelledby="servings-label" className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label id="servings-label" htmlFor="servings-input" className="font-medium">
          {t('recipes.converter.label')}
        </label>
        <Button
          variant="secondary"
          aria-label={t('recipes.converter.decrease')}
          disabled={compare(target, ONE) <= 0}
          onClick={() => apply(stepTarget(target, -1))}
        >
          <span aria-hidden="true">&minus;</span>
        </Button>
        <input
          id="servings-input"
          data-testid="servings-input"
          className={`${INPUT} w-24 text-center`}
          inputMode="decimal"
          autoComplete="off"
          value={text}
          aria-invalid={invalid}
          aria-describedby={invalid ? 'servings-error' : 'servings-hint'}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = parseTarget(event.target.value);
            if (parsed !== null) onTarget(parsed);
          }}
          onBlur={() => {
            if (invalid) apply(target);
          }}
        />
        <Button
          variant="secondary"
          aria-label={t('recipes.converter.increase')}
          onClick={() => apply(stepTarget(target, 1))}
        >
          <span aria-hidden="true">+</span>
        </Button>
        <span className="text-text-muted">{yieldLabel(unit)}</span>
        {preview && (
          <Button variant="secondary" data-testid="servings-reset" onClick={() => apply(base)}>
            {t('recipes.converter.reset')}
          </Button>
        )}
      </div>
      {invalid ? (
        <p id="servings-error" role="alert" className="mt-2 text-danger">
          <span aria-hidden="true">! </span>
          {t('recipes.converter.invalid')}
        </p>
      ) : (
        <p id="servings-hint" className="mt-2 text-sm text-text-muted" aria-live="polite">
          {preview
            ? t('recipes.converter.preview', { servings: formatServings(base) })
            : t('recipes.converter.saved', { servings: formatServings(base) })}
        </p>
      )}
    </section>
  );
}

function IngredientRow({ view }: { view: LineView }) {
  return (
    <li data-testid="ingredient-line" className="flex gap-3 py-1">
      <span className="w-24 shrink-0 font-medium">{view.quantityText}</span>
      <span>
        {view.name}
        {view.note !== null && `, ${view.note}`}
      </span>
    </li>
  );
}

/**
 * Yield converter, ingredients and directions (R2). The converter is local state only: nothing is
 * saved or sent, and it resets when the page unmounts (AC-14).
 */
export function RecipeBody({ content }: { content: RecipeContentV1 }) {
  const base = useMemo(() => parseYield(content.yield.quantity), [content.yield.quantity]);
  const [target, setTarget] = useState<Rational | null>(null);
  const effective = target ?? base;

  const views = useMemo(
    () =>
      effective === null || base === null
        ? []
        : content.ingredients.map((line) => lineView(line, base, effective)),
    [content.ingredients, base, effective],
  );
  const groups = [...content.ingredient_groups].sort((a, b) => a.order - b.order);
  const blocks = [
    { id: null, name: null, rows: views.filter((v) => v.groupId === null) },
    ...groups.map((g) => ({
      id: g.id,
      name: g.name,
      rows: views.filter((v) => v.groupId === g.id),
    })),
  ].filter((b) => b.rows.length > 0);
  const anyRounded = views.some((v) => v.rounded);
  const steps = [...content.instructions].sort((a, b) => a.order - b.order);

  return (
    <div className="flex flex-col gap-6">
      {base !== null && effective !== null && (
        <ServingsConverter
          base={base}
          unit={content.yield.unit}
          target={effective}
          onTarget={setTarget}
        />
      )}
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:gap-8">
        <section aria-labelledby="ingredients-heading">
          <h2 id="ingredients-heading" className="mb-2 text-lg font-semibold">
            {t('recipes.detail.ingredients')}
          </h2>
          {anyRounded && (
            <p className="mb-2 text-sm text-text-muted">{t('recipes.converter.roundedHint')}</p>
          )}
          {blocks.length === 0 && (
            <p className="text-text-muted">{t('recipes.detail.noIngredients')}</p>
          )}
          {blocks.map((block) => (
            <div key={block.id ?? 'ungrouped'} className="mb-3">
              {block.name !== null && (
                <h3 className="mt-2 text-sm font-semibold uppercase text-text-muted">
                  {block.name}
                </h3>
              )}
              <ul>
                {block.rows.map((view) => (
                  <IngredientRow key={view.id} view={view} />
                ))}
              </ul>
            </div>
          ))}
        </section>
        <section aria-labelledby="directions-heading">
          <h2 id="directions-heading" className="mb-2 text-lg font-semibold">
            {t('recipes.detail.directions')}
          </h2>
          {steps.length === 0 && (
            <p className="text-text-muted">{t('recipes.detail.noDirections')}</p>
          )}
          <ol className="list-decimal space-y-2 pl-6">
            {steps.map((step) => (
              <li key={step.id} className="whitespace-pre-wrap">
                {step.text}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
