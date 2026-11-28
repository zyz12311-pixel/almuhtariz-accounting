const { app, BrowserWindow, shell, ipcMain, dialog, protocol, net } = require('electron');
const { join } = require('path');
const { spawn } = require('child_process');
const isDev = process.env.NODE_ENV === 'development';

// Server runs HTTP on PORT+1 (e.g., 3114 when PORT=3113)
const SERVER_PORT = 3113;
const HTTP_PORT = SERVER_PORT + 1; // 3114
const START_URL = isDev
  ? `http://127.0.0.1:${HTTP_PORT}`
  : `http://127.0.0.1:${HTTP_PORT}`;

let mainWindow = null;
let serverProcess = null;

function createServer() {
  return new Promise((resolve, reject) => {
    const serverPath = join(__dirname, '..', 'server', 'index.js');
    const dbDir = app.getPath('userData');
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

  // Handle external links and window.open for printing
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow printing URLs to open in external browser with session
    if (url.includes('/api/invoices/') && url.includes('/html')) {
      // Pass session cookie via URL parameter for authentication
      const sessionCookie = getSessionCookie();
      const separator = url.includes('?') ? '&' : '?';
      const urlWithSession = `${url}${separator}sid=${sessionCookie}`;
      shell.openExternal(urlWithSession);
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
        const sessionCookie = getSessionCookie();
        const separator = url.includes('?') ? '&' : '?';
        const urlWithSession = `${url}${separator}sid=${sessionCookie}`;
        shell.openExternal(urlWithSession);
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

function getSessionCookie() {
  // Get session cookie from the main window's cookie store
  if (mainWindow) {
    return mainWindow.webContents.session.cookies.get({ url: `http://127.0.0.1:${HTTP_PORT}`, name: 'sid' })
      .then(cookies => cookies[0]?.value || '')
      .catch(() => '');
  }
  return Promise.resolve('');
}

async function startup() {
  try {
    await createServer();
    createWindow();
  } catch (err) {
    console.error('Startup failed:', err);
    dialog.showErrorBox('خطأ في التشغيل', `تعذر تشغيل التطبيق:\n${err.message}`);
    app.quit();
  }
}

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

// IPC handlers for secure communication
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:get-path', (event, name) => app.getPath(name));
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

// Handle print requests from renderer
ipcMain.on('print:invoice', async (event, { invoiceId, profile }) => {
  const sessionCookie = await getSessionCookie();
  const url = `http://127.0.0.1:${HTTP_PORT}/api/invoices/${invoiceId}/html?profile=${profile}&sid=${sessionCookie}`;
  shell.openExternal(url);
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

// Register custom protocol for app resources if needed
protocol.handle('app', (request) => {
  const url = new URL(request.url);
  const filePath = join(__dirname, '..', 'web', url.pathname);
  return net.fetch(`file://${filePath}`);
});