import { Outlet } from 'react-router-dom';
import { Header } from './Header';
import { Footer } from './Footer';

// Root layout route (router.tsx) — every routed page renders inside the
// <Outlet />, so the navbar appears on every page, including ones added
// later, without each page having to render it itself.
export function Layout() {
  return (
    <>
      <Header />
      <Outlet />
      <Footer />
    </>
  );
}
