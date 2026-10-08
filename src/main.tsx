import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { loadWorkspace } from './core/storage';
import { emptyWorkspace, upgradeWorkspace } from './core/components';
import './styles.css';

const loaded = await loadWorkspace();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <App initialWorkspace={upgradeWorkspace(loaded.workspace ?? emptyWorkspace())} storageError={loaded.error} />
</React.StrictMode>);
