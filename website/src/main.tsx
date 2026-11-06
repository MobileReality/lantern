import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/overpass/wght.css';
import '@fontsource-variable/overpass-mono/wght.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/doc.css';
import './styles/highlight.css';

const container = document.getElementById('root');
if (!container) throw new Error('index.html has no #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
