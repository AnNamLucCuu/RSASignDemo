let worker:Worker|undefined, next=0;
const pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void}>();
function start() {
  worker=new Worker(new URL('./crypto/worker.ts',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{const request=pending.get(data.id);if(!request)return;pending.delete(data.id);if(data.error)request.reject(new Error(data.error));else request.resolve(data.result);};
  worker.onerror=()=>{for(const request of pending.values())request.reject(new Error('WORKER'));pending.clear();worker?.terminate();worker=undefined;};
}
export function call<T=any>(action:string,args:Record<string,unknown>={}):Promise<T> {
  if(!worker)start();const id=++next;
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});worker!.postMessage({id,action,args});});
}
export function clearSession() {
  worker?.terminate();worker=undefined;
  for(const request of pending.values())request.reject(new Error('CANCELLED'));pending.clear();
}
