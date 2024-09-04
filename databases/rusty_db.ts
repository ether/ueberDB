import AbstractDatabase from "../lib/AbstractDatabase";
import {KeyValueDB} from "rusty-store-kv";

export default class Rusty_db extends AbstractDatabase {
    db: KeyValueDB|null


    constructor(settings: {filename: string}) {
        super(settings);
        this.db = new KeyValueDB(this.settings.filename!);

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
        return this.db!.get(key);
    }

    async init() {
        console.log("Init")
    }

    close() {

    }

    remove(key: string) {
        this.db!.remove(key);
    }

    set(key: string, value: string) {
        this.db!.set(key, value);
    }

    destroy() {
        this.db!.destroy();
    }
}
