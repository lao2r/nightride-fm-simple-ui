const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
let mainWindow;

app.on('ready', function() {
    mainWindow = new BrowserWindow({
      width: 840,
      height: 640,
      resizable: false,
      frame: false,
      transparent: true,
      alwaysOnTop: false,
      skipTaskbar: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
    }
    })
  
    mainWindow.loadURL(`file://${__dirname}/index.html`);

});

app.on('browser-window-focus', function () {
    globalShortcut.register("CommandOrControl+R", () => {
        // Do nothing
    });
    globalShortcut.register("F5", () => {
        // Do nothing
    });
});

app.on('browser-window-blur', function () {
    globalShortcut.unregister('CommandOrControl+R');
    globalShortcut.unregister('F5');
});

ipcMain.on('minimize-window', () => {
    mainWindow.minimize();
});

ipcMain.on('close-window', () => {
    mainWindow.close();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});


