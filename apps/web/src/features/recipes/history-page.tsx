import { useQuery } from '@tanstack/react-query';
import type { RecipeVersionMeta } from '@mise/contracts';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, buttonClass } from '../../components/button.js';
import { ErrorState } from '../../components/error-state.js';
import { PageHeader } from '../../components/page-header.js';
import { SkeletonRows } from '../../components/skeleton.js';
import { t } from '../../i18n/index.js';
import { isApiError } from '../../lib/api-client.js';
import { useMe } from '../auth/use-session.js';
import { ArchivedNote } from './archived-note.js';
import { recipeKeys, useRecipe } from './queries.js';
import { RestoreVersionDialog } from './restore-version-dialog.js';
import { authorKey } from './recipe-view.js';
import { useRecipesApi } from './use-recipes-api.js';

const DATE_TIME = { dateStyle: 'medium', timeStyle: 'short' } as const;

export function formatDateTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('fi-FI', { ...DATE_TIME, timeZone }).format(new Date(instant));
}

export function RecipeHistoryPage() {
  const { id = '' } = useParams();
  const api = useRecipesApi();
  const me = useMe().data;
  const recipe = useRecipe(id);
  const versions = useQuery({
    queryKey: recipeKeys.versions(id),
    queryFn: () => api.listVersions(id),
  });
  const [restoring, setRestoring] = useState<RecipeVersionMeta | null>(null);
  const timeZone = me?.household.timezone ?? 'Europe/Helsinki';

  const title = recipe.data?.title ?? t('recipes.history.title');
  const header = (
    <PageHeader
      title={t('recipes.history.heading', { title })}
      back={{ to: `/recipes/${id}`, label: t('recipes.history.back') }}
    />
  );

  if (recipe.isPending || versions.isPending) {
    return (
      <>
        {header}
        <SkeletonRows testId="history-loading" />
      </>
    );
  }
  const failure = recipe.error ?? versions.error;
  if (failure !== null || recipe.data === undefined || versions.data === undefined) {
    return (
      <>
        {header}
        <ErrorState
          correlationId={isApiError(failure) ? failure.correlationId : undefined}
          onRetry={() => {
            void recipe.refetch();
            void versions.refetch();
          }}
        />
      </>
    );
  }

  const current = recipe.data.currentVersion.id;
  const archived = recipe.data.archivedAt !== null;
  return (
    <>
      {header}
      {archived && <ArchivedNote recipe={recipe.data} />}
      <ul aria-label={t('recipes.history.listLabel')} className="flex flex-col gap-3">
        {versions.data.map((version) => {
          const isCurrent = version.id === current;
          return (
            <li
              key={version.id}
              data-testid="version-row"
              data-version-no={version.versionNo}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <p className="font-semibold">
                {t('recipes.history.version', { version: version.versionNo })}
                {isCurrent && (
                  <span className="ml-2 rounded-md border border-border px-2 py-0.5 text-xs uppercase">
                    {t('recipes.history.current')}
                  </span>
                )}
              </p>
              <p className="text-sm text-text-muted">
                {t('recipes.history.byAt', {
                  author: t(authorKey(version.createdByMemberId, me?.member.id)),
                  date: formatDateTime(version.createdAt, timeZone),
                })}
              </p>
              <p className="my-2">{version.changeReason ?? t('recipes.history.noReason')}</p>
              <div className="flex flex-wrap justify-end gap-2">
                <Link
                  to={`/recipes/${id}/versions/${version.id}`}
                  className={buttonClass('secondary')}
                  aria-label={t('recipes.history.viewLabel', { version: version.versionNo })}
                >
                  {t('recipes.history.view')}
                </Link>
                {!isCurrent && !archived && (
                  <Button
                    variant="secondary"
                    aria-label={t('recipes.history.restoreLabel', { version: version.versionNo })}
                    onClick={() => setRestoring(version)}
                  >
                    {t('recipes.history.restore')}
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <RestoreVersionDialog
        recipe={recipe.data}
        version={restoring}
        onClose={() => setRestoring(null)}
      />
    </>
  );
}
