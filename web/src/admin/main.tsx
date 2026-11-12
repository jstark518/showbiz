import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Before `App`, so this file's rules are evaluated before any stylesheet a
// plugin imports from a component. Plugin styles are meant to build on these.
import './admin.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
