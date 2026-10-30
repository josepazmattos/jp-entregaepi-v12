import * as store from '../db/store.js';
import {createFacialService} from './facial.service.js';
import {createFacialControl} from './facial-control.service.js';
// The SDK bundle is loaded only when the facial feature is enabled and invoked.
let runtime;
const provider=new Proxy({}, {get:(_,name)=>async(...args)=>{
  runtime ||= import('./facial-provider.runtime.mjs');
  return (await runtime).provider[name](...args);
}});
export const facialControl=createFacialControl({store,provider});
export const facial=createFacialService({store,provider,settings:facialControl.settings});
