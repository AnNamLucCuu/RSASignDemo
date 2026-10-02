import {Worker} from 'node:worker_threads';
import {readdirSync} from 'node:fs';
import {pathToFileURL,URL as NodeURL} from 'node:url';
import {resolve} from 'node:path';
let worker:Worker|undefined,next=0;
const pending=new Map<number,{resolve:(data:any)=>void;reject:(e:Error)=>void}>();
export function call(action:string,args:Record<string,unknown>={}):Promise<any> {
  if(!worker) {
    const bundle=readdirSync('dist/assets').find(name=>/^worker-.*\.js$/.test(name));
    if(!bundle)throw Error('Build the production bundle before running UI tests.');
    worker=new Worker(new NodeURL('./worker-harness.mjs',import.meta.url),{workerData:{url:pathToFileURL(resolve('dist/assets',bundle)).href},execArgv:[]});
    worker.on('message',data=>{const req=pending.get(data.id);if(!req)return;pending.delete(data.id);if(data.error)req.reject(Error(data.error));else req.resolve(data.result);});
    worker.on('error',error=>{for(const req of pending.values())req.reject(error);pending.clear();});
  }
  const id=++next;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker!.postMessage({id,action,args});});
}
export function clearSession() {void worker?.terminate();worker=undefined;for(const req of pending.values())req.reject(Error('CANCELLED'));pending.clear();}
