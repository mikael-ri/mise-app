import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { buttonClass } from '../../components/button.js';
import { ConfirmDialog } from '../../components/confirm-dialog.js';
import { EmptyState } from '../../components/empty-state.js';
import { ErrorState } from '../../components/error-state.js';
import { Menu, MenuItem, MenuLink } from '../../components/menu.js';
import { PageHeader } from '../../components/page-header.js';
import { SkeletonRows } from '../../components/skeleton.js';
import { useToast } from '../../components/toast.js';
import { formatDate, t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { useMe } from '../auth/use-session.js';
import { RecipeBody } from './recipe-body.js';
import { authorKey, sourceLink, totalMinutes } from './recipe-view.js';
import { cacheWrittenRecipe, useRecipe } from './queries.js';
import { loadDraft } from './draft-storage.js';
import { ArchivedNote } from './archived-note.js';
import { useRecipesApi } from './use-recipes-api.js';

export function RecipeMeta({
  recipe,
}: {
  recipe: NonNullable<ReturnType<typeof useRecipe>['data']>;
}) {
  const me = useMe().data;
  const total = totalMinutes(recipe.content);
  const source = sourceLink(recipe.sourceUrl);
  const version = recipe.currentVersion;
  return (
    <div className="mb-4 flex flex-col gap-1">
      {recipe.tags.length > 0 && <p className="text-text-muted">{recipe.tags.join(', ')}</p>}
      <p>
        {total !== null && (
          <span className="mr-3">{t('recipes.detail.minutes', { count: total })}</span>
        )}
        {source !== null && (
          <span>
            {t('recipes.detail.source')}{' '}
            <a
              href={source.href}
              rel="noopener noreferrer"
              target="_blank"
              className="text-primary underline"
            >
              {source.label}
            </a>
          </span>
        )}
      </p>
      <p className="text-sm text-text-muted">
        {t('recipes.detail.lastChanged', {
          author: t(authorKey(version.createdByMemberId, me?.member.id)),
          date: formatDate(version.createdAt, {
            timeZone: me?.household.timezone ?? 'Europe/Helsinki',
          }),
          version: version.versionNo,
        })}
      </p>
    </div>
  );
}

export function RecipeDetailPage() {
  const { id = '' } = useParams();
  const api = useRecipesApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const recipe = useRecipe(id);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const setArchived = useMutation({
    mutationFn: (archived: boolean) => {
      if (recipe.data === undefined) throw new Error('recipe not loaded');
      return api.patch(id, recipe.data.revision, { archived });
    },
    onSuccess: (updated, archived) => {
      cacheWrittenRecipe(queryClient, updated);
      setArchiveOpen(false);
      toast.show(
        t(archived ? 'recipes.archive.toast' : 'recipes.restore.toast', { title: updated.title }),
      );
    },
    // Someone else changed it meanwhile: show the current state before the user decides again.
    onError: () => void recipe.refetch(),
  });

  const back = { to: '/recipes', label: t('recipes.detail.back') };

  if (recipe.isPending) {
    return (
      <>
        <PageHeader title={t('recipes.detail.loading')} back={back} />
        <SkeletonRows testId="recipe-loading" rows={2} />
      </>
    );
  }
  if (recipe.isError) {
    if (isApiError(recipe.error) && recipe.error.status === 404) {
      return (
        <>
          <PageHeader title={t('recipes.detail.notFound.title')} back={back} />
          <EmptyState
            title={t('recipes.detail.notFound.title')}
            description={t('recipes.detail.notFound.description')}
            action={
              <Link to="/recipes" className={buttonClass()}>
                {t('recipes.detail.back')}
              </Link>
            }
          />
        </>
      );
    }
    return (
      <>
        <PageHeader title={t('nav.recipes')} back={back} />
        <ErrorState
          correlationId={isApiError(recipe.error) ? recipe.error.correlationId : undefined}
          onRetry={() => void recipe.refetch()}
        />
      </>
    );
  }

  const data = recipe.data;
  const archived = data.archivedAt !== null;
  const hasDraft = loadDraft(id) !== null;
  return (
    <>
      <PageHeader
        title={data.title}
        back={back}
        actions={
          <Menu label={t('recipes.detail.menu')}>
            {archived ? (
              <MenuItem disabled onSelect={() => undefined}>
                {t('recipes.detail.edit')}
              </MenuItem>
            ) : (
              <MenuLink to={`/recipes/${id}/edit`}>{t('recipes.detail.edit')}</MenuLink>
            )}
            <MenuLink to={`/recipes/${id}/versions`}>{t('recipes.detail.history')}</MenuLink>
            <MenuItem disabled={archived} onSelect={() => setArchiveOpen(true)}>
              {t('recipes.detail.archive')}
            </MenuItem>
          </Menu>
        }
      />
      {archived && <ArchivedNote recipe={data} />}
      {hasDraft && !archived && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
        >
          <p>{t('recipes.detail.draftKept')}</p>
          <Link to={`/recipes/${id}/edit`} className={buttonClass('secondary')}>
            {t('recipes.detail.draftContinue')}
          </Link>
        </div>
      )}
      {setArchived.isError && !archiveOpen && (
        <div className="mb-4">
          <ErrorState
            message={t('recipes.archive.error')}
            correlationId={
              isApiError(setArchived.error) ? setArchived.error.correlationId : undefined
            }
          />
        </div>
      )}
      <RecipeMeta recipe={data} />
      <RecipeBody key={data.currentVersion.id} content={data.content} />
      <section aria-labelledby="notes-heading" className="mt-6">
        <h2 id="notes-heading" className="mb-2 text-lg font-semibold">
          {t('recipes.detail.notes')}
        </h2>
        <p className="whitespace-pre-wrap">{data.generalNotes ?? t('recipes.detail.noNotes')}</p>
        {!archived && (
          <Link to={`/recipes/${id}/edit`} className={`${buttonClass('secondary')} mt-2`}>
            {t('recipes.detail.editNotes')}
          </Link>
        )}
      </section>
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={(open) => {
          setArchiveOpen(open);
          if (!open) setArchived.reset();
        }}
        title={t('recipes.archive.title', { title: data.title })}
        description={t('recipes.archive.description')}
        confirmLabel={t('recipes.archive.confirm')}
        pending={setArchived.isPending}
        error={setArchived.isError ? t('recipes.archive.error') : undefined}
        onConfirm={() => setArchived.mutate(true)}
      />
    </>
  );
}
