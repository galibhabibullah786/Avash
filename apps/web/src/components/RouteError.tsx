import { useRouteError } from 'react-router-dom';
import { ErrorFallback } from '@avash/ui';

export function RouteError() {
  const error = useRouteError();
  // Full detail stays in the dev console only; the user never sees a raw
  // error or stack trace (R10). React Router's data routers catch render
  // errors per-route with their own default page, so this errorElement
  // replaces that default rather than relying solely on the outer
  // <ErrorBoundary> in App.tsx.
  console.error('Unhandled route error', error);
  return <ErrorFallback />;
}
