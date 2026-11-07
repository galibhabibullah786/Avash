import { lazy, Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';

const GeminiChatPopup = lazy(() =>
  import('./GeminiChatPopup').then((m) => ({ default: m.GeminiChatPopup }))
);

// Root layout route (router.tsx) — every routed page renders inside the
// <Outlet />, so the navbar appears on every page, including ones added
// later, without each page having to render it itself.
export function Layout() {
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
      <Suspense fallback={null}>
        <GeminiChatPopup />
      </Suspense>
    </>
  );
}
