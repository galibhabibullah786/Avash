import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ensureServiceWorkerRegistration } from './lib/serviceWorker';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Registered at boot, not only when someone clicks "Enable push
// notifications". Two reasons, both load-bearing:
//
//  - A browser that already granted permission on a previous visit needs
//    an active worker before the dashboard can even ask whether a push
//    subscription still exists. Registering lazily meant that check ran
//    against no worker at all on a cold load.
//  - Installability. A browser only offers "Install app" for a page that
//    has a manifest AND a service worker with a fetch handler, and on
//    iOS/iPadOS an installed app is the ONLY context where Web Push
//    works at all. No registration at boot meant no install prompt, which
//    meant no push on Apple devices, ever.
//
// Never awaited and never allowed to reject into the console: a failed
// registration (private mode, an unsupported browser, plain HTTP on a
// non-localhost origin) degrades the app to in-page alerts, it does not
// break rendering — which has already happened above.
void ensureServiceWorkerRegistration();
