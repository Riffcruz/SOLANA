import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import SolanaProvider from './components/SolanaProvider';
import { Buffer } from 'buffer';

// Styles are now loaded in index.html to ensure they are applied globally.

// Polyfill Buffer for the browser environment, as it's required by Solana's libraries.
window.Buffer = Buffer;

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <SolanaProvider>
      <App />
    </SolanaProvider>
  </React.StrictMode>
);
