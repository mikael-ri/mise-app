import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../lib/api-client.js';
import { renderApp } from '../../test/render-app.js';
import { ME } from '../../test/fixtures.js';
import { expectNoAxeViolations } from '../../test/axe.js';
import {
  OTHER_MEMBER_ID,
  RECIPE_ID,
  recipeList,
  recipeVersion,
  salmonRecipe,
  uuid,
  versionMeta,
} from './recipe-fixtures.js';
import { draftFromRecipe } from './form-model.js';
import { loadDraft, saveDraft } from './draft-storage.js';
import type { RecipesApi } from './recipes-api.js';

const stale = () =>
  new ApiError({ status: 409, code: 'stale_revision', message: 'x', correlationId: 'c-9' });

function fakeRecipes(over: Partial<RecipesApi> = {}): RecipesApi {
  const recipe = salmonRecipe();
  return {
    search: vi.fn().mockResolvedValue(
      recipeList([
        { id: RECIPE_ID, title: 'Uunilohi ja perunat', tags: ['kala', 'arki'] },
        { id: uuid(101), title: 'Äidin kääretorttu', tags: ['jälkiruoka'] },
      ]),
    ),
    get: vi.fn().mockResolvedValue(recipe),
    create: vi.fn().mockResolvedValue(recipe),
    patch: vi.fn().mockResolvedValue(recipe),
    listVersions: vi
      .fn()
      .mockResolvedValue([
        recipe.currentVersion,
        versionMeta(2, OTHER_MEMBER_ID, 'Lisäsin sitruunan'),
        versionMeta(1, OTHER_MEMBER_ID, null),
      ]),
    getVersion: vi.fn().mockResolvedValue(recipeVersion(2, recipe.content)),
    restore: vi.fn().mockResolvedValue(recipe),
    ...over,
  };
}

describe('recipe list (FR-01, FR-02, FR-07, AC-02, AC-18)', () => {
  it('AC-18: renders Finnish names and filters by tag chip taken from loaded results', async () => {
    const api = fakeRecipes();
    renderApp('/recipes', undefined, api);
    expect(await screen.findByText('Äidin kääretorttu')).toBeInTheDocument();
    expect(screen.getAllByTestId('recipe-card')).toHaveLength(2);
    await userEvent.click(screen.getByRole('button', { name: 'jälkiruoka' }));
    await waitFor(() =>
      expect(api.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ tags: ['jälkiruoka'] }),
      ),
    );
  });

  it('AC-02: searches by name after the debounce and shows no-results with Clear search', async () => {
    const api = fakeRecipes();
    renderApp('/recipes', undefined, api);
    await screen.findByText('Uunilohi ja perunat');
    vi.mocked(api.search).mockResolvedValue(recipeList([]));
    await userEvent.type(screen.getByTestId('recipe-search-input'), 'kääre');
    await waitFor(() =>
      expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'kääre' })),
    );
    expect(await screen.findByText('No recipes match "kääre"')).toBeInTheDocument();
    vi.mocked(api.search).mockResolvedValue(
      recipeList([{ id: RECIPE_ID, title: 'Uunilohi ja perunat' }]),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() => expect(screen.getByTestId('recipe-search-input')).toHaveValue(''));
  });

  it('shows empty, error and load-more states', async () => {
    const empty = fakeRecipes({ search: vi.fn().mockResolvedValue(recipeList([])) });
    const view = renderApp('/recipes', undefined, empty);
    expect(await screen.findByText('No recipes yet')).toBeInTheDocument();
    view.unmount();

    const failing = fakeRecipes({
      search: vi
        .fn()
        .mockRejectedValue(
          new ApiError({ status: 500, code: 'internal_error', message: 'x', correlationId: 'abc' }),
        ),
    });
    const second = renderApp('/recipes', undefined, failing);
    expect(await screen.findByText('Reference: abc')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    second.unmount();

    const paged = fakeRecipes({
      search: vi
        .fn()
        .mockResolvedValueOnce(recipeList([{ id: uuid(1), title: 'Yksi' }], 20))
        .mockResolvedValueOnce(recipeList([{ id: uuid(2), title: 'Kaksi' }])),
    });
    renderApp('/recipes', undefined, paged);
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    expect(await screen.findByText('Kaksi')).toBeInTheDocument();
    expect(paged.search).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 }));
  });

  it('shows archived recipes with Restore only when asked, and restores without a version', async () => {
    const api = fakeRecipes({
      search: vi
        .fn()
        .mockResolvedValue(recipeList([{ id: RECIPE_ID, title: 'Vanha', archived: true }])),
    });
    renderApp('/recipes?archived=1', undefined, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Restore Vanha' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(RECIPE_ID, 1, { archived: false }));
  });
});

describe('recipe detail and servings converter (FR-06, AC-14)', () => {
  it('AC-14: previews 3 servings without calling the API, then resets', async () => {
    const api = fakeRecipes();
    renderApp(`/recipes/${RECIPE_ID}`, undefined, api);
    expect(await screen.findByRole('heading', { name: 'Uunilohi ja perunat' })).toBeInTheDocument();
    expect(screen.getAllByTestId('ingredient-line')[0]).toHaveTextContent('600 g');

    const input = screen.getByTestId('servings-input');
    expect(input).toHaveValue('4');
    await userEvent.clear(input);
    await userEvent.type(input, '3');
    const rows = screen.getAllByTestId('ingredient-line');
    expect(rows[0]).toHaveTextContent('450 g');
    expect(rows[0]).toHaveTextContent('lohifilettä');
    expect(rows[1]).toHaveTextContent('600 g');
    expect(rows[1]).toHaveTextContent('perunaa, kuorittuna');
    expect(rows[3]).toHaveTextContent('~1–2 kpl');
    expect(rows[4]).toHaveTextContent('maun mukaan');
    expect(screen.getByText('Rounded for practicality')).toBeInTheDocument();
    expect(screen.getByText(/Preview only, not saved/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('servings-reset'));
    expect(input).toHaveValue('4');
    expect(screen.getAllByTestId('ingredient-line')[0]).toHaveTextContent('600 g');
    expect(screen.queryByTestId('servings-reset')).not.toBeInTheDocument();

    expect(api.patch).not.toHaveBeenCalled();
    expect(api.create).not.toHaveBeenCalled();
    expect(api.restore).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('shows "You" for the signed-in member as author, with the version number', async () => {
    renderApp(`/recipes/${RECIPE_ID}`, undefined, fakeRecipes());
    expect(await screen.findByText(/Last changed by You, .* \(v3\)/)).toBeInTheDocument();
    expect(ME.member.id).toBeDefined();
  });

  it('shows a not-found state', async () => {
    const api = fakeRecipes({
      get: vi
        .fn()
        .mockRejectedValue(
          new ApiError({ status: 404, code: 'not_found', message: 'x', correlationId: 'c' }),
        ),
    });
    renderApp(`/recipes/${RECIPE_ID}`, undefined, api);
    expect(await screen.findAllByText('Recipe not found')).not.toHaveLength(0);
  });

  it('archive asks for confirmation naming the recipe, then sends archived=true with the revision', async () => {
    const api = fakeRecipes();
    renderApp(`/recipes/${RECIPE_ID}`, undefined, api);
    await screen.findByRole('heading', { name: 'Uunilohi ja perunat' });
    await userEvent.click(screen.getByRole('button', { name: 'Recipe actions' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Archive "Uunilohi ja perunat"?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(RECIPE_ID, 3, { archived: true }));
  });

  it('passes axe', async () => {
    const view = renderApp(`/recipes/${RECIPE_ID}`, undefined, fakeRecipes());
    await screen.findByRole('heading', { name: 'Uunilohi ja perunat' });
    await expectNoAxeViolations(view.container);
  });
});

describe('version history and restore (FR-03, AC-03)', () => {
  it('AC-03: lists every version with author labels and reasons, newest first', async () => {
    renderApp(`/recipes/${RECIPE_ID}/versions`, undefined, fakeRecipes());
    const rows = await screen.findAllByTestId('version-row');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('v3');
    expect(rows[0]).toHaveTextContent('Current');
    expect(rows[0]).toHaveTextContent('You');
    expect(rows[0]).not.toHaveTextContent('Restore');
    expect(rows[1]).toHaveTextContent('Another household member');
    expect(rows[1]).toHaveTextContent('Lisäsin sitruunan');
    expect(rows[2]).toHaveTextContent('(no reason given)');
  });

  it('AC-03: restore confirms, then restores with the current revision and an idempotency key', async () => {
    const api = fakeRecipes();
    renderApp(`/recipes/${RECIPE_ID}/versions`, undefined, api);
    await userEvent.click(await screen.findByRole('button', { name: 'Restore v2' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      "This creates a new version v4 with v2's content. Nothing is deleted.",
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() =>
      expect(api.restore).toHaveBeenCalledWith(
        RECIPE_ID,
        3,
        uuid(302),
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ),
    );
  });

  it('AC-03: an older version opens read-only with a not-current banner and a working converter', async () => {
    renderApp(`/recipes/${RECIPE_ID}/versions/${uuid(302)}`, undefined, fakeRecipes());
    expect(await screen.findByText('You are viewing v2 (not current)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore this version' })).toBeInTheDocument();
    expect(screen.getAllByTestId('ingredient-line')).toHaveLength(5);
    expect(screen.getByTestId('servings-input')).toBeInTheDocument();
  });
});

describe('recipe form (FR-01, FR-03, FR-05)', () => {
  it('create: validates inline, then posts one version-1 body with an idempotency key', async () => {
    const api = fakeRecipes();
    renderApp('/recipes/new', undefined, api);
    await userEvent.click(
      (await screen.findAllByRole('button', { name: 'Create recipe' }))[0] as HTMLElement,
    );
    expect(await screen.findAllByText('This is required.')).not.toHaveLength(0);
    expect(api.create).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Title')).toHaveFocus();

    await userEvent.type(screen.getByLabelText('Title'), 'Kasvissosekeitto');
    await userEvent.type(screen.getByLabelText('Yield'), '4');
    await userEvent.type(screen.getByLabelText('Amount'), '2,5');
    await userEvent.type(screen.getByLabelText('Unit'), 'dl');
    await userEvent.type(screen.getByLabelText('Ingredient'), 'kasvislientä');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Create recipe' })[0] as HTMLElement,
    );
    await waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    const [body, key] = vi.mocked(api.create).mock.calls[0] ?? [];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(body?.title).toBe('Kasvissosekeitto');
    expect(body?.content.yield).toEqual({ quantity: '4', unit: 'servings' });
    expect(body?.content.ingredients[0]).toMatchObject({
      display_name: 'kasvislientä',
      original_quantity_text: '2,5 dl',
      amount_min: '2.5',
      original_unit: 'dl',
    });
  });

  it('edit: the button reads Save for metadata and Save new version for cooking content', async () => {
    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, fakeRecipes());
    expect((await screen.findAllByRole('button', { name: 'Save' }))[0]).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Yield'));
    await userEvent.type(screen.getByLabelText('Yield'), '6');
    expect(screen.getAllByRole('button', { name: 'Save new version' })[0]).toBeInTheDocument();
    expect(screen.getByLabelText('What changed? (optional)')).toBeInTheDocument();
  });

  it('asks before leaving with unsaved edits', async () => {
    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, fakeRecipes());
    await userEvent.type(await screen.findByLabelText('Title'), ' x');
    await userEvent.click(screen.getByRole('link', { name: 'Close without saving' }));
    expect(await screen.findByText('Leave without saving?')).toBeInTheDocument();
  });

  it('R3a: a second conflict on "Save mine as newest" shows the dialog again and keeps the draft', async () => {
    const api = fakeRecipes({
      patch: vi.fn().mockRejectedValue(stale()),
    });
    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, api);
    const title = await screen.findByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Uunilohi ja uudet perunat');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);

    const dialog = await screen.findByTestId('conflict-dialog');
    expect(dialog).toHaveTextContent(
      'Another household member saved a newer version while you were editing.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save mine as newest' }));
    expect(dialog).toHaveTextContent('This replaces the current content with your edits.');
    vi.mocked(api.get).mockResolvedValue(salmonRecipe({ revision: 5 }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace with my edits' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.patch).mock.calls[1]?.[1]).toBe(5);
    expect(
      await within(await screen.findByTestId('conflict-dialog')).findByText(/Someone saved again/),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByLabelText('Title')).toHaveValue('Uunilohi ja uudet perunat');
  });

  it('R3a: Save mine as newest succeeds on top of the latest revision', async () => {
    const api = fakeRecipes({
      patch: vi
        .fn()
        .mockRejectedValueOnce(stale())
        .mockResolvedValue(salmonRecipe({ revision: 6 })),
    });
    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, api);
    const title = await screen.findByLabelText('Title');
    await userEvent.type(title, '!');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);
    const dialog = await screen.findByTestId('conflict-dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save mine as newest' }));
    vi.mocked(api.get).mockResolvedValue(salmonRecipe({ revision: 5 }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Replace with my edits' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.patch).mock.calls[1]?.[1]).toBe(5);
    await waitFor(() => expect(screen.queryByTestId('conflict-dialog')).not.toBeInTheDocument());
  });

  it.each([
    ['the refetch fails', 'get'],
    ['the PATCH returns 500', 'patch'],
  ] as const)(
    'R3a: when %s, the dialog shows an error and the draft stays',
    async (_name, failing) => {
      const boom = new ApiError({
        status: 500,
        code: 'internal_error',
        message: 'x',
        correlationId: 'c',
      });
      const api = fakeRecipes({ patch: vi.fn().mockRejectedValueOnce(stale()) });
      renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, api);
      const title = await screen.findByLabelText('Title');
      await userEvent.clear(title);
      await userEvent.type(title, 'Uusi nimi');
      await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);
      const dialog = await screen.findByTestId('conflict-dialog');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Save mine as newest' }));
      if (failing === 'get') vi.mocked(api.get).mockRejectedValue(boom);
      else vi.mocked(api.patch).mockRejectedValue(boom);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Replace with my edits' }));
      expect(await within(dialog).findByText(/Could not save the recipe/)).toBeInTheDocument();
      await userEvent.keyboard('{Escape}');
      expect(screen.getByLabelText('Title')).toHaveValue('Uusi nimi');
    },
  );

  it('create: a retry after a network failure reuses the same Idempotency-Key', async () => {
    const offline = new ApiError({ status: 0, code: 'network_error', message: 'x' });
    const api = fakeRecipes({
      create: vi.fn().mockRejectedValueOnce(offline).mockResolvedValue(salmonRecipe()),
    });
    renderApp('/recipes/new', undefined, api);
    await userEvent.type(await screen.findByLabelText('Title'), 'Keitto');
    await userEvent.type(screen.getByLabelText('Yield', { exact: true }), '4');
    await userEvent.type(screen.getByLabelText('Ingredient'), 'vettä');
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Create recipe' })[0] as HTMLElement,
    );
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    await screen.findByText(/Could not save the recipe/);
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Create recipe' })[0] as HTMLElement,
    );
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(2));
    const calls = vi.mocked(api.create).mock.calls;
    expect(calls[1]?.[1]).toBe(calls[0]?.[1]);
  });

  it('FR-01: a typed draft is stored, restored with a notice, and Discard draft clears it', async () => {
    localStorage.clear();
    const first = renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, fakeRecipes());
    const title = await screen.findByLabelText('Title');
    await userEvent.type(title, ' kokeilu');
    await waitFor(() => expect(localStorage.length).toBe(1), { timeout: 2000 });
    first.unmount();

    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, fakeRecipes());
    expect(await screen.findByTestId('draft-notice')).toHaveTextContent(
      'Your unsaved draft was restored.',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Uunilohi ja perunat kokeilu');
    await userEvent.click(screen.getByRole('button', { name: 'Discard draft' }));
    expect(screen.queryByTestId('draft-notice')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Uunilohi ja perunat');
    expect(localStorage.length).toBe(0);
  });

  it('FR-01: a stored draft based on an older revision is kept with the changed-recipe notice', async () => {
    localStorage.clear();
    const old = salmonRecipe({ revision: 2 });
    saveDraft(RECIPE_ID, { ...draftFromRecipe(old), title: 'Oma versio' }, 2);
    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, fakeRecipes());
    expect(await screen.findByTestId('draft-notice')).toHaveTextContent(
      'has changed since you started',
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Oma versio');
  });

  it('FR-01: a successful save clears the stored draft', async () => {
    localStorage.clear();
    saveDraft(RECIPE_ID, { ...draftFromRecipe(salmonRecipe()), title: 'Uusi nimi' }, 3);
    const api = fakeRecipes();
    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, api);
    await screen.findByTestId('draft-notice');
    await userEvent.click(screen.getAllByRole('button', { name: 'Save' })[0] as HTMLElement);
    await waitFor(() => expect(api.patch).toHaveBeenCalled());
    await waitFor(() => expect(loadDraft(RECIPE_ID)).toBeNull());
  });

  it('FR-01: leaving after the confirmation clears the draft', async () => {
    localStorage.clear();
    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, fakeRecipes());
    await userEvent.type(await screen.findByLabelText('Title'), ' x');
    await userEvent.click(screen.getByRole('link', { name: 'Close without saving' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Leave' }),
    );
    await waitFor(() => expect(loadDraft(RECIPE_ID)).toBeNull());
  });

  it('archived recipes are read-only: note with Restore, no edit, on detail and version views', async () => {
    const archived = salmonRecipe({ archivedAt: '2026-10-28T10:00:00Z' });
    const api = fakeRecipes({ get: vi.fn().mockResolvedValue(archived) });
    const view = renderApp(`/recipes/${RECIPE_ID}`, undefined, api);
    const note = await screen.findByTestId('archived-note');
    expect(note).toHaveTextContent('Restore this recipe to edit it.');
    await userEvent.click(screen.getByRole('button', { name: 'Recipe actions' }));
    expect(await screen.findByRole('menuitem', { name: 'Edit' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(note).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(RECIPE_ID, 3, { archived: false }));
    view.unmount();

    renderApp(`/recipes/${RECIPE_ID}/versions/${uuid(302)}`, undefined, api);
    expect(await screen.findByTestId('archived-note')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore this version' })).not.toBeInTheDocument();
  });

  it('list: archived cards carry a text badge and Restore; summary fields show when present', async () => {
    const api = fakeRecipes({
      search: vi.fn().mockResolvedValue({
        items: [
          {
            id: RECIPE_ID,
            title: 'Vanha',
            tags: [],
            archivedAt: '2026-10-28T10:00:00Z',
            revision: 1,
            updatedAt: '2026-10-27T16:12:00Z',
            totalMinutes: 35,
            yield: { quantity: '4', unit: 'servings' },
          },
          {
            id: uuid(2),
            title: 'Uusi',
            tags: [],
            archivedAt: null,
            revision: 1,
            updatedAt: '2026-10-27T16:12:00Z',
            totalMinutes: null,
            yield: null,
          },
        ],
        nextOffset: null,
      }),
    });
    renderApp('/recipes?archived=1', undefined, api);
    const cards = await screen.findAllByTestId('recipe-card');
    expect(within(cards[0] as HTMLElement).getByTestId('archived-badge')).toHaveTextContent(
      'Archived',
    );
    expect(cards[0]).toHaveTextContent('35 min \u00b7 4 serv.');
    expect(within(cards[1] as HTMLElement).queryByTestId('archived-badge')).not.toBeInTheDocument();
    expect(screen.getByTestId('show-archived')).toBeChecked();
  });

  it('a stored draft with a stale format is dropped and the form opens empty', async () => {
    localStorage.clear();
    localStorage.setItem(
      `mise.recipe-draft.v1.${RECIPE_ID}`,
      JSON.stringify({ version: 0, draft: { title: 'Vanha' }, baseRevision: 3, savedAt: 'x' }),
    );
    renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, fakeRecipes());
    expect(await screen.findByLabelText('Title')).toHaveValue('Uunilohi ja perunat');
    expect(screen.queryByTestId('draft-notice')).not.toBeInTheDocument();
  });

  it('signing out clears stored drafts', async () => {
    localStorage.clear();
    saveDraft(RECIPE_ID, draftFromRecipe(salmonRecipe()), 3);
    expect(localStorage.length).toBe(1);
    const { endSession } = await import('../../lib/session.js');
    const { QueryClient } = await import('@tanstack/react-query');
    endSession(new QueryClient(), 'signed_out');
    expect(localStorage.length).toBe(0);
  });

  it('passes axe on the form', async () => {
    const view = renderApp(`/recipes/${RECIPE_ID}/edit`, undefined, fakeRecipes());
    await screen.findByLabelText('Title');
    await expectNoAxeViolations(view.container);
  });
});
