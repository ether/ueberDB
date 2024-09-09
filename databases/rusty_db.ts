import AbstractDatabase from "../lib/AbstractDatabase";
import {KeyValueDB} from 'rusty-store-kv'

export default class Rusty_db extends AbstractDatabase {
    db: any |null| undefined

    constructor(settings: {filename: string}) {
        super(settings);

        // set default settings
        this.settings.cache = 0;
        this.settings.writeInterval = 0;
        this.settings.json = false;
    }

    get isAsync() {
        return true;
    }

    findKeys(key: string, notKey?:string) {
        return this.db!.findKeys(key, notKey);
    }

    get(key: string) {
        const val = this.db!.get(key);
        if (!val) {
            return val
        }
        try {
            return JSON.parse(val)
        } catch (e) {
            return val
        }
    }

    async init() {

        this.db = new KeyValueDB(this.settings.filename!);
    }

    close() {
        this.db?.close()
        this.db = null
    }

    remove(key: string) {
        this.db!.remove(key);
    }

    set(key: string, value: string) {
        if (typeof value ===  "object") {
            const valStr = JSON.stringify(value)
            this.db!.set(key, valStr);
        } else {
            this.db!.set(key, value.toString());
        }
    }

    destroy() {
        this.db!.destroy();
    }
}
