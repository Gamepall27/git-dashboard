import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <main className="boot"><h1>Git Dashboard</h1><p>Dein Workspace für lokale Repositories.</p></main>
</React.StrictMode>);
