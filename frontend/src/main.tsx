import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initTelegramWebApp, initVisualViewportVar, loadTelegramWebApp } from './telegram';
import './styles.css';

// Ждём SDK до первого рендера: от него зависит, покажем ли мы вход по паролю
// или сразу пойдём по telegram-сценарию. Вне Telegram промис резолвится сразу.
void loadTelegramWebApp().then(() => {
  initVisualViewportVar();
  initTelegramWebApp();

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
