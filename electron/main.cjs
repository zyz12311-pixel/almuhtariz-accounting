// Electron main process - avoids require('electron') at top level due to npm package shadowing
// We'll require electron modules lazily after the main window is created

const { join } = require('path');
const { spawn } = require('child_process');
const isDev = process.env.NODE_ENV === 'development';

// Server runs HTTP on PORT+1 (e.g., 3114 when PORT=3113)
const SERVER_PORT = 3113;
const HTTP_PORT = SERVER_PORT + 1; // 3114
const START_URL = `http://127.0.0.1:${HTTP_PORT}`;

let mainWindow = null;
let serverProcess = null;
let printWindow = null;

// Electron modules - loaded lazily
let app = null;
let BrowserWindow = null;
let shell = null;
let ipcMain = null;
let dialog = null;
let protocol = null;
let net = null;

function loadElectronModules() {
  // In Electron context, require('electron') returns the internal module
  // But npm package shadows it - we can't easily get the internal module
  // Instead, we'll use the fact that the modules are available globally in Electron
  // or we'll require them after the main window is created
  try {
    const electron = require('electron');
    if (typeof electron === 'object' && electron.app) {
      // Got the internal module
      app = electron.app;
      BrowserWindow = electron.BrowserWindow;
      shell = electron.shell;
      ipcMain = electron.ipcMain;
      dialog = electron.dialog;
      protocol = electron.protocol;
      net = electron.net;
    } else {
      // Got the path string - we're in a shadowed context
      // The internal modules will be available via mainWindow.webContents.session etc.
      // For now, we'll use process.execPath for app path and defer the rest
      throw new Error('Electron module shadowed by npm package');
    }
  } catch (e) {
    console.warn('Could not load electron modules directly:', e.message);
    // We'll set them up in createWindow after mainWindow exists
  }
}

// Load immediately - might work in some contexts
loadElectronModules();

function createServer() {
  return new Promise((resolve, reject) => {
    const serverPath = join(__dirname, '..', 'server', 'index.js');
    const dbDir = app?.getPath ? app.getPath('userData') : process.env.APPDATA + '\\almuhtariz-accounting';
    const dbFile = join(dbDir, 'almuhtariz.db');
    const licenseFile = join(dbDir, 'license.json');

    const env = {
      ...process.env,
      SMARTZ_DATA: dbDir,
      PORT: String(SERVER_PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'production'
    };

    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: join(__dirname, '..'),
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      console.log(`[Server] ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
      console.error(`[Server Error] ${data}`);
    });

    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      reject(err);
    });

    // Wait for HTTP server to be ready (runs on PORT+1)
    const checkServer = setInterval(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/state`);
        if (response.ok) {
          clearInterval(checkServer);
          resolve();
        }
      } catch {
        // Server not ready yet
      }
    }, 500);

    setTimeout(() => {
      clearInterval(checkServer);
      reject(new Error('Server startup timeout'));
    }, 30000);
  });
}

function createWindow() {
  // Ensure electron modules are loaded
  if (!BrowserWindow) {
    loadElectronModules();
  }
  
  // If still not loaded, we can't proceed
  if (!BrowserWindow || !app || !shell || !ipcMain || !dialog || !protocol || !net) {
    console.error('Electron modules not available');
    dialog?.showErrorBox?.('خطأ في التشغيل', 'وحدات Electron غير متاحة');
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    icon: join(__dirname, '..', 'assets', 'almuhtariz-logo.png'),
    title: 'المحترز للمحاسبة وإدارة الأعمال',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false
    },
    show: false,
    backgroundColor: '#f5f5f5'
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links (non-print)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow printing URLs to open in Electron print window
    if (url.includes('/api/invoices/') && url.includes('/html')) {
      const invoiceId = url.split('/api/invoices/')[1].split('/')[0];
      const profileMatch = url.match(/profile=([^&]+)/);
      const profile = profileMatch ? profileMatch[1] : 'accountant';
      createPrintWindow(invoiceId, profile);
      return { action: 'deny' };
    }
    // Allow other external links
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  // Prevent navigation to external URLs
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    if (parsedUrl.origin !== `http://127.0.0.1:${HTTP_PORT}`) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Handle new window creation (for target="_blank" links)
  mainWindow.webContents.on('did-create-window', (window) => {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (url.includes('/api/invoices/') && url.includes('/html')) {
        const invoiceId = url.split('/api/invoices/')[1].split('/')[0];
        const profileMatch = url.match(/profile=([^&]+)/);
        const profile = profileMatch ? profileMatch[1] : 'accountant';
        createPrintWindow(invoiceId, profile);
      } else {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });
  });

  // Load the app from HTTP server
  mainWindow.loadURL(START_URL).catch((err) => {
    console.error('Failed to load URL:', err);
    dialog.showErrorBox('خطأ في التحميل', `تعذر تحميل التطبيق:\n${err.message}`);
  });
}

function createPrintWindow(invoiceId, profile = 'accountant') {
  // Close existing print window if open
  if (printWindow) {
    printWindow.close();
  }

  // Use main window's session for authentication (shares cookies)
  const sharedSession = mainWindow?.webContents?.session;
  
  if (!sharedSession) {
    console.error('Main window session not available');
    dialog.showErrorBox('خطأ في الطباعة', 'جلسة المصادقة غير متاحة');
    return;
  }
  
  printWindow = new BrowserWindow({
    width: 800,
    height: 1000,
    minWidth: 600,
    minHeight: 800,
    icon: join(__dirname, '..', 'assets', 'almuhtariz-logo.png'),
    title: 'طباعة الفاتورة',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      session: sharedSession // Share session with main window for authentication
    },
    show: false,
    parent: mainWindow,
    modal: false
  });

  printWindow.once('ready-to-show', () => {
    printWindow.show();
    // Focus the print window
    printWindow.focus();
  });

  printWindow.on('closed', () => {
    printWindow = null;
  });

  // Load the invoice print page directly - session cookie is shared
  const printUrl = `http://127.0.0.1:${HTTP_PORT}/api/invoices/${invoiceId}/html?profile=${profile}`;
  printWindow.loadURL(printUrl).catch((err) => {
    console.error('Failed to load print URL:', err);
    dialog.showErrorBox('خطأ في الطباعة', `تعذر تحميل صفحة الطباعة:\n${err.message}`);
    printWindow.close();
  });

  // Handle print completion - trigger print dialog after content loads
  printWindow.webContents.on('did-finish-load', () => {
    // Trigger print dialog after a short delay to ensure content is rendered
    setTimeout(() => {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.webContents.print({
          silent: false,
          printBackground: true,
          margins: { marginType: 'none' }
        }, (success, errorType) => {
          if (!success) {
            console.error('Print failed:', errorType);
          }
          // Keep window open for user to review, don't auto-close
        });
      }
    }, 500);
  });
}

async function startup() {
  try {
    await createServer();
    createWindow();
  } catch (err) {
    console.error('Startup failed:', err);
    dialog?.showErrorBox?.('خطأ في التشغيل', `تعذر تشغيل التطبيق:\n${err.message}`);
    app?.quit?.();
  }
}

if (app) {
  app.whenReady().then(startup);

  app.on('window-all-closed', () => {
    if (serverProcess) {
      serverProcess.kill();
    }
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('before-quit', () => {
    if (serverProcess) {
      serverProcess.kill();
    }
  });
}

// IPC handlers for secure communication
if (ipcMain) {
  ipcMain.handle('app:get-version', () => app?.getVersion?.() || '0.0.0');
  ipcMain.handle('app:get-path', (event, name) => app?.getPath?.(name));
  ipcMain.handle('dialog:show-save-dialog', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, options);
    return result;
  });
  ipcMain.handle('dialog:show-open-dialog', async (event, options) => {
    const result = await dialog.showOpenDialog(mainWindow, options);
    return result;
  });
  ipcMain.handle('shell:open-external', async (event, url) => {
    await shell.openExternal(url);
    return { success: true };
  });
  ipcMain.handle('shell:open-path', async (event, path) => {
    await shell.openPath(path);
    return { success: true };
  });

  // Handle print requests from renderer - opens in-Electron print window with shared session
  ipcMain.on('print:invoice', async (event, { invoiceId, profile }) => {
    createPrintWindow(invoiceId, profile);
  });

  // Handle keyboard focus issues
  ipcMain.on('focus:barcode', () => {
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        const input = document.getElementById('barcode-input');
        if (input) { input.focus(); input.select(); }
      `);
    }
  });
}

// Register custom protocol for app resources if needed
if (protocol && net) {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const filePath = join(__dirname, '..', 'web', url.pathname);
    return net.fetch(`file://${filePath}`);
  });
}