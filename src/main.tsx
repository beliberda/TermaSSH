import React from 'react';
import ReactDOM from 'react-dom/client';
import { StoreProvider } from '@stores/index';
import { logFrontendError } from '@ipc/log';
import App from './App.tsx';
import './index.css';

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// No top-level React error boundary exists, so an uncaught exception (e.g.
// thrown inside a drag/drop or transfer handler) otherwise only shows up as
// a blank/frozen window with nothing in termassh.log to explain why.
window.addEventListener('error', (e) => {
  logFrontendError(e.message, e.error instanceof Error ? e.error.stack : undefined);
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logFrontendError(`Unhandled rejection: ${message}`, stack);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
