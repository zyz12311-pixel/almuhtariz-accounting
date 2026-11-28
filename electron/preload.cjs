const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getVersion: () => ipcRenderer.invoke('app:get-version'),
  getPath: (name) => ipcRenderer.invoke('app:get-path', name),

  // Dialogs
  showSaveDialog: (options) => ipcRenderer.invoke('dialog:show-save-dialog', options),
  showOpenDialog: (options) => ipcRenderer.invoke('dialog:show-open-dialog', options),

  // Shell
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  openPath: (path) => ipcRenderer.invoke('shell:open-path', path),

  // Print invoice (opens in external browser for proper printing)
  printInvoice: (invoiceId, profile = 'accountant') => {
    ipcRenderer.send('print:invoice', { invoiceId, profile });
  },

  // Focus management for barcode scanner
  focusBarcode: () => ipcRenderer.send('focus:barcode'),

  // Platform info
  platform: process.platform,

  // Check if running in Electron
  isElectron: true
});

// Override window.open for printing to use Electron's shell
const originalWindowOpen = window.open.bind(window);
window.open = function(url, target, features) {
  // If it's an invoice print URL, use Electron's shell
  if (typeof url === 'string' && url.includes('/api/invoices/') && url.includes('/html')) {
    ipcRenderer.send('print:invoice', {
      invoiceId: url.split('/api/invoices/')[1].split('/')[0],
      profile: url.includes('profile=') ? url.split('profile=')[1].split('&')[0] : 'accountant'
    });
    return null;
  }
  // For other external URLs, use shell.openExternal
  if (typeof url === 'string' && (url.startsWith('http:') || url.startsWith('https:'))) {
    ipcRenderer.invoke('shell:open-external', url);
    return null;
  }
  // Default behavior for same-origin
  return originalWindowOpen(url, target, features);
};

// Provide a stable origin for localStorage/IndexedDB regardless of port
// This is handled by the server running on a fixed port in Electron
Object.defineProperty(window, 'ELECTRON_FIXED_ORIGIN', {
  value: `http://127.0.0.1:3113`,
  writable: false,
  configurable: false
});

// Expose a safe navigation helper to prevent race conditions
contextBridge.exposeInMainWorld('navigation', {
  navigate: (hash) => {
    // Use a promise to handle async navigation
    return new Promise((resolve) => {
      const currentHash = window.location.hash.slice(1);
      if (currentHash === hash) {
        resolve(false); // Already on this page
        return;
      }
      window.location.hash = '#' + hash;
      // Listen for hashchange
      const handler = () => {
        window.removeEventListener('hashchange', handler);
        resolve(true);
      };
      window.addEventListener('hashchange', handler, { once: true });
      // Fallback timeout
      setTimeout(() => {
        window.removeEventListener('hashchange', handler);
        resolve(false);
      }, 5000);
    });
  },
  getCurrentPage: () => window.location.hash.slice(1) || 'dashboard'
});

// Safe logout that doesn't depend on IndexedDB
contextBridge.exposeInMainWorld('auth', {
  logout: async () => {
    try {
      await fetch('/api/logout', { method: 'POST', body: JSON.stringify({}) });
    } catch (e) {
      console.warn('Logout API call failed:', e);
    }
    // Always reload regardless of IndexedDB status
    window.location.reload();
  }
});