import {parentPort,workerData} from 'node:worker_threads';
import {createApp} from '../server/index.js';
const {server,db}=createApp({dbFile:workerData.dbFile,licensePath:workerData.licensePath});
server.listen(0,'127.0.0.1',()=>parentPort.postMessage({port:server.address().port}));
parentPort.on('message',message=>{if(message==='close'){server.close(()=>{db.close();parentPort.close();});server.closeAllConnections();}});
