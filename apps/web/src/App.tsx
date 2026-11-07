import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { router } from './router';
import { ErrorBoundary } from '@avash/ui';
import { queryClient } from './lib/queryClient';
import { SessionProvider } from './features/auth/SessionProvider';
import { InstallPromptProvider } from './features/alerts/InstallPromptContext';

export default function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <InstallPromptProvider>
            <RouterProvider router={router} />
          </InstallPromptProvider>
        </SessionProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
