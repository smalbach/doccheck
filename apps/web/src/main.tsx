import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { detectLocale } from './i18n/detectLocale';
import { loadMessages } from './i18n/loadMessages';
import { en } from './i18n/messages/en';
import './styles/index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

// The chosen language's dictionary first (English is bundled; es/fr are small separate files),
// falling back to English if it cannot be fetched.
const locale = detectLocale();
void loadMessages(locale)
  .then((messages) => ({ locale, messages }), () => ({ locale: 'en' as const, messages: en }))
  .then(({ locale: initialLocale, messages }) =>
    createRoot(root).render(
      <StrictMode>
        <App initialLocale={initialLocale} initialMessages={messages} />
      </StrictMode>,
    ),
  );
