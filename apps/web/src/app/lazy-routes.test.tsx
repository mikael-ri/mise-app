import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { describe, expect, it } from 'vitest';
import { RouteError } from '../components/route-error.js';

describe('lazy routes (NFR-05)', () => {
  it('a route chunk that fails to load shows the error state with Try again', async () => {
    const router = createMemoryRouter(
      [
        {
          path: '/recipes',
          errorElement: <RouteError />,
          lazy: () => Promise.reject(new Error('Failed to fetch dynamically imported module')),
        },
      ],
      { initialEntries: ['/recipes'] },
    );
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText(/dynamically imported/)).not.toBeInTheDocument();
  });
});
