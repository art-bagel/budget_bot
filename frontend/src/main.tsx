import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initTelegramWebApp } from './telegram';
import './styles.css';

initTelegramWebApp();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
