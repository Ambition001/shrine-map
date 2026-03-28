import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { validateEnvConfig } from './utils/tokenValidation';

const { valid, missing } = validateEnvConfig();
if (!valid) {
  console.error('[shrine-map] Missing required environment variables:', missing.join(', '));
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
