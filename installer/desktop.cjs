const {app,BrowserWindow,dialog,session,ipcMain}=require('electron');
const {spawn}=require('node:child_process');
const path=require('node:path');
const fs=require('node:fs');
const http=require('node:http');
const net=require('node:net');
const root=path.resolve(__dirname,'..','..');
let child,win,printWin,quitting=false,serverPort;
function port(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}
async function start(){
  const p=await port();
  serverPort=p;
  const url='http://127.0.0.1:'+p;
  const data=path.join(process.env.LOCALAPPDATA,'Almuhtariz','data');
  fs.mkdirSync(data,{recursive:true});
  const libs=path.join(root,'tools','zatca-lib');
  const env={...process.env,PORT:String(p-1),ALMUHTARIZ_DATA:data,ZATCA_JAVA:path.join(root,'runtime','java','bin','java.exe'),ZATCA_XMLSEC_HELPER_DIR:path.join(root,'server','zatca','java','build'),ZATCA_XMLSEC_CLASSPATH:fs.readdirSync(libs).filter(x=>x.endsWith('.jar')).map(x=>path.join(libs,x)).join(path.delimiter)};
  const log=fs.openSync(path.join(data,'desktop-server.log'),'a');
  child=spawn(path.join(root,'runtime','node.exe'),['--no-warnings',path.join(root,'server','index.js')],{cwd:root,env,windowsHide:true,stdin:'ignore',stdout:log,stderr:log});
  fs.closeSync(log);
  let failure;
  child.on('error',e=>failure=e);
  child.on('exit',code=>{failure=new Error('Server exited: '+code);if(win&&!quitting){dialog.showErrorBox('Almuhtariz Accounting',failure.message);app.quit();}});
  for(let i=0;i<60;i++){
    if(failure)throw failure;
    const ready=await new Promise(resolve=>{const req=http.get(url,res=>{res.resume();resolve(res.statusCode===200);});req.on('error',()=>resolve(false));req.setTimeout(1000,()=>req.destroy());});
    if(ready){
      win=new BrowserWindow({width:1440,height:900,minWidth:900,minHeight:600,autoHideMenuBar:true,icon:path.join(root,'web','assets','almuhtariz-logo.png'),webPreferences:{partition:'almuhtariz-ephemeral',contextIsolation:true,nodeIntegration:false,sandbox:true}});
      win.webContents.setWindowOpenHandler(({url})=>{
        if(url.includes('/api/invoices/')&&url.includes('/html')){
          const invoiceId=url.split('/api/invoices/')[1].split('/')[0];
          const profileMatch=url.match(/profile=([^&]+)/);
          const profile=profileMatch?profileMatch[1]:'accountant';
          createPrintWindow(invoiceId,profile,url);
          return {action:'deny'};
        }
        return {action:'deny'};
      });
      win.webContents.on('will-navigate',(e,target)=>{if(new URL(target).origin!==url)e.preventDefault();});
      await win.loadURL(url);return;
    }
    await new Promise(r=>setTimeout(r,500));
  }
  throw new Error('Local server startup timed out');
}
function createPrintWindow(invoiceId,profile,printUrl){
  if(printWin){
    printWin.close();
  }
  const sharedSession=win?.webContents?.session;
  if(!sharedSession){
    console.error('Main window session not available for printing');
    return;
  }
  printWin=new BrowserWindow({
    width:800,
    height:1000,
    minWidth:600,
    minHeight:800,
    icon:path.join(root,'web','assets','almuhtariz-logo.png'),
    title:'طباعة الفاتورة',
    webPreferences:{
      contextIsolation:true,
      nodeIntegration:false,
      sandbox:true,
      session:sharedSession
    },
    show:false,
    parent:win,
    modal:false
  });
  printWin.once('ready-to-show',()=>{printWin.show();printWin.focus();});
  printWin.on('closed',()=>{printWin=null;});
  printWin.loadURL(printUrl).catch(err=>{console.error('Failed to load print URL:',err);dialog.showErrorBox('خطأ في الطباعة',`تعذر تحميل صفحة الطباعة:\n${err.message}`);printWin.close();});
  printWin.webContents.on('did-finish-load',()=>{setTimeout(()=>{if(printWin&&!printWin.isDestroyed()){printWin.webContents.print({silent:false,printBackground:true,margins:{marginType:'none'}},()=>{});}},500);});
}
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
  app.whenReady().then(()=>{
    ipcMain.on('print:invoice',(_,{invoiceId,profile})=>{
      const printUrl=`http://127.0.0.1:${serverPort}/api/invoices/${invoiceId}/html?profile=${profile||'accountant'}`;
      createPrintWindow(invoiceId,profile||'accountant',printUrl);
    });
    start().catch(e=>{dialog.showErrorBox('Almuhtariz Accounting',String(e));app.quit();});
  });
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{quitting=true;if(child)child.kill();});
}
