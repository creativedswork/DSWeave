import React from 'react';
import ReactDOM from 'react-dom/client';
import { Player } from './Player.js';
import { loadSceneSpec } from './spec.js';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <Player spec={loadSceneSpec()} />
  </React.StrictMode>,
);
