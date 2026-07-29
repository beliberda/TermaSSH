import React from 'react';
import ReactDOM from 'react-dom/client';
import { StoreProvider } from '@stores/index';
import App from './App.tsx';
import './index.css';

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </React.StrictMode>,
);
