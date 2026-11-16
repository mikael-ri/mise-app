import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, buttonClass } from '../../components/button.js';
import { EmptyState } from '../../components/empty-state.js';
import { ErrorState } from '../../components/error-state.js';
import { PageHeader } from '../../components/page-header.js';
import { SkeletonRows } from '../../components/skeleton.js';
import { t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { useMe } from '../auth/use-session.js';
import { formatDateTime } from './history-page.js';
import { ArchivedNote } from './archived-note.js';
import { RecipeBody } from './recipe-body.js';
import { authorKey } from './recipe-view.js';
import { recipeKeys, useRecipe } from './queries.js';
import { RestoreVersionDialog } from './restore-version-dialog.js';
import { useRecipesApi } from './use-recipes-api.js';

/** R4 "View": the R2 layout, read-only, with a not-current banner and Restore. */
export function RecipeVersionPage() {
  const { id = '', versionId = '' } = useParams();
  const api = useRecipesApi();
  const me = useMe().data;
  const recipe = useRecipe(id);
  const version = useQuery({
    queryKey: recipeKeys.version(id, versionId),
    queryFn: () => api.getVersion(id, versionId),
  });
  const [restoring, setRestoring] = useState(false);
  const back = { to: `/recipes/${id}/versions`, label: t('recipes.version.back') };

  if (recipe.isPending || version.isPending) {
    return (
      <>
        <PageHeader title={t('recipes.detail.loading')} back={back} />
        <SkeletonRows testId="version-loading" rows={2} />
      </>
    );
  }
  const failure = recipe.error ?? version.error;
  if (failure !== null || recipe.data === undefined || version.data === undefined) {
    if (isApiError(failure) && failure.status === 404) {
      return (
        <>
          <PageHeader title={t('recipes.version.notFound')} back={back} />
          <EmptyState
            title={t('recipes.version.notFound')}
            action={
              <Link to={`/recipes/${id}/versions`} className={buttonClass()}>
                {t('recipes.version.back')}
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
          correlationId={isApiError(failure) ? failure.correlationId : undefined}
          onRetry={() => {
            void recipe.refetch();
            void version.refetch();
          }}
        />
      </>
    );
  }

  const meta = version.data.version;
  const isCurrent = meta.id === recipe.data.currentVersion.id;
  const archived = recipe.data.archivedAt !== null;
  return (
    <>
      <PageHeader title={recipe.data.title} back={back} />
      {archived && <ArchivedNote recipe={recipe.data} />}
      {!isCurrent && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-border p-3"
        >
          <p className="font-medium">{t('recipes.version.banner', { version: meta.versionNo })}</p>
          {!archived && (
            <Button onClick={() => setRestoring(true)}>{t('recipes.version.restore')}</Button>
          )}
        </div>
      )}
      <p className="mb-4 text-sm text-text-muted">
        {t('recipes.history.byAt', {
          author: t(authorKey(meta.createdByMemberId, me?.member.id)),
          date: formatDateTime(meta.createdAt, me?.household.timezone ?? 'Europe/Helsinki'),
        })}
        {meta.changeReason !== null && ` – ${meta.changeReason}`}
      </p>
      <RecipeBody key={meta.id} content={version.data.content} />
      <RestoreVersionDialog
        recipe={recipe.data}
        version={restoring ? meta : null}
        onClose={() => setRestoring(false)}
      />
    </>
  );
}
