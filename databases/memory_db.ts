import AbstractDatabase, {Settings} from '../lib/AbstractDatabase';
import {MemoryDB as MemInternal} from 'rusty-store-kv'
import {convertToDynamicType} from "../lib/utils";

export default class MemoryDB extends AbstractDatabase {
  public db: null|MemInternal;
  constructor(settings:Settings) {
    super(settings);
    this.settings = settings;
    settings.json = false;
    settings.cache = 0;
    settings.writeInterval = 0;
    this.db = null;
  }

  get isAsync() { return true; }

  close() {
    this.db = null;
  }

  findKeys(key:string, notKey:string) {
    return this.db!.findKeys(key, notKey)
  }

  get(key:string) {
    const getVal = this.db!.get(key)

    if (getVal === undefined|| getVal === null) {
      return null
    }

    return convertToDynamicType(getVal);
  }

  init() {
    this.db = new MemInternal()
    if (this.settings.data) {
      this.settings.data.forEach((v,k)=>{
        console.log(k,v)
        this.db!.set(k,v)
      })
    }

  }

  remove(key:string) {
    this.db!.remove(key)
  }

  set(key:string, value:string) {
    const json = JSON.stringify(value)
    console.log("Test", json)
    this.db!.set(key, json)
  }
};
