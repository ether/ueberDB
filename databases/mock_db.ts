import {Settings} from '../lib/AbstractDatabase';

import events from 'events';

export const Database = class extends events.EventEmitter {
  private settings: Settings;
  public mock: any;
  constructor(settings:Settings) {
    super();
    this.settings = {
      writeInterval: 1,
      ...settings,
    };
    settings.mock = this;
    this.settings = settings;
    console.log("Initialized")
  }

  close(cb: ()=>{}) {
    this.emit('close', cb);
  }

  doBulk(ops:string, cb: ()=>{}) {
    this.emit('doBulk', ops, cb);
  }

  findKeys(key:string, notKey:string, cb:()=>{}) {
    this.emit('findKeys', key, notKey, cb);
  }

  get(key:string, cb:()=>{}) {
    this.emit('get', key, cb);
  }

 async init(cb:()=>{}) {
   this.emit('init', cb());
  }

  remove(key:string, cb:()=>{}) {
    this.emit('remove', key, cb);
  }

  set(key:string, value:string, cb:()=>{}) {
    this.emit('set', key, value, cb);
  }
};
