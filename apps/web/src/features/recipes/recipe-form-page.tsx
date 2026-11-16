import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Recipe } from '@mise/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { Button } from '../../components/button.js';
import { ConfirmDialog } from '../../components/confirm-dialog.js';
import { EmptyState } from '../../components/empty-state.js';
import { ErrorState } from '../../components/error-state.js';
import { Field, INPUT_CLASS, invalidProps } from '../../components/form-field.js';
import { SkeletonRows } from '../../components/skeleton.js';
import { useToast } from '../../components/toast.js';
import { t } from '../../i18n/index.js';
import type { MessageKey } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { ConflictDialog } from './conflict-dialog.js';
import type { ConflictStep } from './conflict-dialog.js';
import { errorText } from './editor-types.js';
import type { EditorProps } from './editor-types.js';
import {
  addTag,
  buildSubmission,
  draftFromRecipe,
  emptyDraft,
  hasErrors,
  isDirty,
  removeTag,
  saveKind,
  validateDraft,
} from './form-model.js';
import type { FieldError, RecipeDraft, SaveKind } from './form-model.js';
import { IngredientEditor } from './ingredient-editor.js';
import { cacheWrittenRecipe, recipeKeys, useRecipe } from './queries.js';
import { clearDraft, loadDraft, saveDraft } from './draft-storage.js';
import { isStaleRevision, saveMineAsNewest } from './save-flow.js';
import { useDebouncedValue } from './use-debounced-value.js';
import { StepsEditor } from './steps-editor.js';
import { useRecipesApi } from './use-recipes-api.js';

const SAVE_LABEL: Record<SaveKind, MessageKey> = {
  create: 'recipes.form.save.create',
  new_version: 'recipes.form.save.newVersion',
  save: 'recipes.form.save.save',
};

const FORM_ID = 'recipe-form';
const DRAFT_SAVE_DEBOUNCE_MS = 500;

function TagsField({ draft, update }: Pick<EditorProps, 'draft' | 'update'>) {
  const [text, setText] = useState('');
  const add = () => {
    update((d) => addTag(d, text));
    setText('');
  };
  return (
    <div className="flex flex-col gap-2">
      <Field id="recipe-tag" label={t('recipes.form.tags')}>
        <div className="flex gap-2">
          <input
            id="recipe-tag"
            className={INPUT_CLASS}
            autoComplete="off"
            placeholder={t('recipes.form.tagsPlaceholder')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                add();
              }
            }}
          />
          <Button variant="secondary" onClick={add} disabled={text.trim() === ''}>
            {t('recipes.form.tagAdd')}
          </Button>
        </div>
      </Field>
      {draft.tags.length > 0 && (
        <ul aria-label={t('recipes.form.tagsList')} className="flex flex-wrap gap-2">
          {draft.tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-surface px-4"
                aria-label={t('recipes.form.tagRemove', { tag })}
                onClick={() => update((d) => removeTag(d, tag))}
              >
                {tag}
                <span aria-hidden="true">&times;</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface FormProps {
  /** null = create. Frozen at mount: its revision is the `If-Match` of the save. */
  baseline: Recipe | null;
}

function RecipeForm({ baseline }: FormProps) {
  const api = useRecipesApi();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const recipeId = baseline?.id;

  const initial = useMemo<RecipeDraft>(
    () =>
      baseline === null
        ? emptyDraft({ lineId: crypto.randomUUID(), stepId: crypto.randomUUID() })
        : draftFromRecipe(baseline),
    [baseline],
  );
  // A stored draft (typing, reload, "Open latest version") comes back with a notice and Discard.
  const storeKey = recipeId ?? null;
  const [stored, setStored] = useState(() => loadDraft(storeKey));
  const [draft, setDraft] = useState<RecipeDraft>(stored?.draft ?? initial);
  const draftChanged =
    stored !== null && baseline !== null && stored.baseRevision !== baseline.revision;

  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [focusTick, setFocusTick] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const allowLeave = useRef(false);
  const [conflict, setConflict] = useState<{ step: ConflictStep; again: boolean } | null>(null);

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const dirty = isDirty(draft, initial);
  const kind = saveKind(draft, baseline);

  // Debounced autosave of unsaved edits; an unchanged form keeps no draft.
  const debouncedDraft = useDebouncedValue(draft, DRAFT_SAVE_DEBOUNCE_MS);
  useEffect(() => {
    if (allowLeave.current) return;
    if (isDirty(debouncedDraft, initial))
      saveDraft(storeKey, debouncedDraft, baseline?.revision ?? null);
    else clearDraft(storeKey);
  }, [debouncedDraft, initial, storeKey, baseline]);
  const backTo = recipeId === undefined ? '/recipes' : `/recipes/${recipeId}`;

  const update = (change: (d: RecipeDraft) => RecipeDraft) => setDraft(change);
  const touch = (key: string) => setTouched((prev) => new Set(prev).add(key));
  const errorFor = (key: string, code: FieldError | undefined): string | undefined =>
    code !== undefined && (submitted || touched.has(key)) ? errorText(code) : undefined;
  const editor: EditorProps = { draft, update, errors, errorFor, touch };
  const field = (
    key: keyof Pick<
      typeof errors,
      'title' | 'yieldQuantity' | 'prepMinutes' | 'cookMinutes' | 'sourceUrl'
    >,
  ) => errorFor(key, errors[key]);

  // Unsaved-changes guard: in-app navigation and tab close.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  useEffect(() => {
    if (focusTick > 0)
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [focusTick]);

  // Idempotency key for create: reused for a retry of the same payload, new once the payload changes.
  const createKey = useRef<{ payload: string; key: string } | null>(null);

  const leaveTo = (path: string) => {
    allowLeave.current = true;
    void navigate(path);
  };

  const finish = (saved: Recipe) => {
    allowLeave.current = true;
    clearDraft(storeKey);
    cacheWrittenRecipe(queryClient, saved);
    toast.show(t(baseline === null ? 'recipes.form.toast.created' : 'recipes.form.toast.saved'));
    leaveTo(`/recipes/${saved.id}`);
  };

  const save = useMutation({
    mutationFn: async (): Promise<Recipe | null> => {
      const submission = buildSubmission(draft, baseline);
      if (submission.kind === 'invalid') throw new Error('draft rejected by the contract');
      if (submission.kind === 'noop') return null;
      if (submission.kind === 'create') {
        const payload = JSON.stringify(submission.body);
        if (createKey.current?.payload !== payload) {
          createKey.current = { payload, key: crypto.randomUUID() };
        }
        return api.create(submission.body, createKey.current.key);
      }
      if (baseline === null) throw new Error('baseline missing');
      return api.patch(baseline.id, baseline.revision, submission.body);
    },
    onSuccess: (saved) => {
      if (saved === null) {
        clearDraft(storeKey);
        allowLeave.current = true;
        leaveTo(backTo);
      } else finish(saved);
    },
    onError: (error) => {
      if (isStaleRevision(error)) setConflict({ step: 'choose', again: false });
    },
  });

  const saveMine = useMutation({
    mutationFn: () => {
      if (baseline === null) throw new Error('baseline missing');
      return saveMineAsNewest(api, baseline.id, draft, baseline);
    },
    onSuccess: (result) => {
      if (result.kind === 'saved') {
        setConflict(null);
        finish(result.recipe);
      } else if (result.kind === 'nothing_to_save') {
        setConflict(null);
        leaveTo(backTo);
      } else {
        // Someone saved again: nothing is lost, the draft stays as it is. Offer the choices again.
        setConflict({ step: 'choose', again: true });
      }
    },
  });

  const submit = () => {
    setSubmitted(true);
    if (hasErrors(errors)) {
      setFocusTick((n) => n + 1);
      return;
    }
    save.mutate();
  };

  const openLatest = () => {
    if (recipeId === undefined) return;
    saveDraft(storeKey, draft, baseline?.revision ?? null);
    void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
    setConflict(null);
    leaveTo(backTo);
  };
  const discard = () => {
    allowLeave.current = true;
    clearDraft(storeKey);
    if (recipeId !== undefined) {
      void queryClient.invalidateQueries({ queryKey: recipeKeys.detail(recipeId) });
    }
    setConflict(null);
    leaveTo(backTo);
  };

  const saveError =
    save.isError && !isStaleRevision(save.error)
      ? isApiError(save.error) && save.error.status === 409
        ? t('recipes.form.error.archived')
        : t('recipes.form.error.save')
      : undefined;
  const saveButton = (
    <Button type="submit" form={FORM_ID} disabled={save.isPending}>
      {save.isPending ? t('recipes.form.saving') : t(SAVE_LABEL[kind])}
    </Button>
  );

  return (
    <>
      <header className="mb-4 flex min-h-11 items-center gap-3">
        <Link
          to={backTo}
          aria-label={t('recipes.form.close')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-2xl"
        >
          <span aria-hidden="true">&times;</span>
        </Link>
        <h1 className="text-xl font-semibold">
          {t(baseline === null ? 'recipes.form.titleNew' : 'recipes.form.titleEdit')}
        </h1>
        <div className="ml-auto">{saveButton}</div>
      </header>

      <form
        id={FORM_ID}
        ref={formRef}
        noValidate
        className="mx-auto flex max-w-[45rem] flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {stored !== null && (
          <div
            role="status"
            data-testid="draft-notice"
            className="flex flex-col items-start gap-2 rounded-lg border border-border p-3"
          >
            <p>{t(draftChanged ? 'recipes.form.draftChanged' : 'recipes.form.restoredDraft')}</p>
            <Button
              variant="secondary"
              onClick={() => {
                clearDraft(storeKey);
                setStored(null);
                setDraft(initial);
              }}
            >
              {t('recipes.form.discardDraft')}
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-3">
          <Field id="recipe-title" label={t('recipes.form.title')} error={field('title')}>
            <input
              {...invalidProps('recipe-title', field('title'))}
              className={INPUT_CLASS}
              autoComplete="off"
              value={draft.title}
              onChange={(e) => update((d) => ({ ...d, title: e.target.value }))}
              onBlur={() => touch('title')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="recipe-yield" label={t('recipes.form.yield')} error={field('yieldQuantity')}>
              <input
                {...invalidProps('recipe-yield', field('yieldQuantity'))}
                className={INPUT_CLASS}
                inputMode="decimal"
                autoComplete="off"
                value={draft.yieldQuantity}
                onChange={(e) => update((d) => ({ ...d, yieldQuantity: e.target.value }))}
                onBlur={() => touch('yieldQuantity')}
              />
            </Field>
            <Field id="recipe-yield-unit" label={t('recipes.form.yieldUnit')}>
              <input
                id="recipe-yield-unit"
                className={INPUT_CLASS}
                autoComplete="off"
                value={draft.yieldUnit}
                onChange={(e) => update((d) => ({ ...d, yieldUnit: e.target.value }))}
              />
            </Field>
            <Field id="recipe-prep" label={t('recipes.form.prep')} error={field('prepMinutes')}>
              <input
                {...invalidProps('recipe-prep', field('prepMinutes'))}
                className={INPUT_CLASS}
                inputMode="numeric"
                autoComplete="off"
                value={draft.prepMinutes}
                onChange={(e) => update((d) => ({ ...d, prepMinutes: e.target.value }))}
                onBlur={() => touch('prepMinutes')}
              />
            </Field>
            <Field id="recipe-cook" label={t('recipes.form.cook')} error={field('cookMinutes')}>
              <input
                {...invalidProps('recipe-cook', field('cookMinutes'))}
                className={INPUT_CLASS}
                inputMode="numeric"
                autoComplete="off"
                value={draft.cookMinutes}
                onChange={(e) => update((d) => ({ ...d, cookMinutes: e.target.value }))}
                onBlur={() => touch('cookMinutes')}
              />
            </Field>
          </div>
          <TagsField draft={draft} update={update} />
          <Field id="recipe-source" label={t('recipes.form.source')} error={field('sourceUrl')}>
            <input
              {...invalidProps('recipe-source', field('sourceUrl'))}
              className={INPUT_CLASS}
              type="url"
              inputMode="url"
              autoComplete="off"
              placeholder={t('recipes.form.sourcePlaceholder')}
              value={draft.sourceUrl}
              onChange={(e) => update((d) => ({ ...d, sourceUrl: e.target.value }))}
              onBlur={() => touch('sourceUrl')}
            />
          </Field>
        </div>

        <IngredientEditor {...editor} errorFor={(key, code) => errorFor(key, code)} />
        <StepsEditor {...editor} />

        <Field id="recipe-notes" label={t('recipes.form.notes')}>
          <textarea
            id="recipe-notes"
            rows={3}
            className={INPUT_CLASS}
            value={draft.generalNotes}
            onChange={(e) => update((d) => ({ ...d, generalNotes: e.target.value }))}
          />
        </Field>

        {kind === 'new_version' && (
          <Field id="recipe-reason" label={t('recipes.form.reason')}>
            <input
              id="recipe-reason"
              className={INPUT_CLASS}
              autoComplete="off"
              maxLength={500}
              value={draft.changeReason}
              onChange={(e) => update((d) => ({ ...d, changeReason: e.target.value }))}
            />
          </Field>
        )}

        {saveError !== undefined && (
          <ErrorState
            message={saveError}
            correlationId={isApiError(save.error) ? save.error.correlationId : undefined}
          />
        )}
        {saveMine.isError && !conflict && <ErrorState message={t('recipes.form.error.save')} />}
        <div>{saveButton}</div>
      </form>

      <ConflictDialog
        open={conflict !== null}
        step={conflict?.step ?? 'choose'}
        again={conflict?.again ?? false}
        pending={saveMine.isPending}
        error={saveMine.isError ? t('recipes.form.error.save') : undefined}
        onClose={() => {
          saveMine.reset();
          setConflict(null);
        }}
        onOpenLatest={openLatest}
        onAskSaveMine={() => setConflict({ step: 'confirm', again: false })}
        onBack={() => setConflict({ step: 'choose', again: false })}
        onSaveMine={() => saveMine.mutate()}
        onDiscard={discard}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title={t('recipes.form.leave.title')}
        description={t('recipes.form.leave.description')}
        confirmLabel={t('recipes.form.leave.confirm')}
        onConfirm={() => {
          if (blocker.state !== 'blocked') return;
          clearDraft(storeKey);
          blocker.proceed();
        }}
      />
    </>
  );
}

export function RecipeFormPage({ mode }: { mode: 'create' | 'edit' }) {
  if (mode === 'create') return <RecipeForm baseline={null} />;
  return <EditRecipeLoader />;
}

function EditRecipeLoader() {
  const { id = '' } = useParams();
  const recipe = useRecipe(id);
  const [baseline, setBaseline] = useState<Recipe | null>(null);

  // Freeze the first fresh copy; later refetches must not change the revision under the form.
  useEffect(() => {
    if (baseline === null && recipe.isFetchedAfterMount && recipe.data !== undefined) {
      setBaseline(recipe.data);
    }
  }, [baseline, recipe.isFetchedAfterMount, recipe.data]);

  if (baseline !== null) return <RecipeForm baseline={baseline} />;
  if (recipe.isError) {
    if (isApiError(recipe.error) && recipe.error.status === 404) {
      return <EmptyState title={t('recipes.detail.notFound.title')} />;
    }
    return (
      <ErrorState
        correlationId={isApiError(recipe.error) ? recipe.error.correlationId : undefined}
        onRetry={() => void recipe.refetch()}
      />
    );
  }
  return <SkeletonRows testId="recipe-form-loading" rows={2} />;
}
