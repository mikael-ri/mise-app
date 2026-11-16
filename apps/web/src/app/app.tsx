import { useState } from 'react';
import { RouterProvider } from 'react-router';
import { AppProviders } from './providers.js';
import { createAppRouter } from './router.js';

export function App() {
  const [router] = useState(createAppRouter);
  return (
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  );
}
