import AbstractDatabase from "../lib/AbstractDatabase";
import {KeyValueDB} from "rusty-store-kv";

export default class Rusty_db extends AbstractDatabase {
    private db: KeyValueDB|null


    constructor(settings: {filename: string}) {
        super(settings);
        this.db = new KeyValueDB(settings.filename);
    }

    get isAsync() {
        return false;
    }

    findKeys(key: string, notKey:string) {
        return this.db!.findKeys(key, notKey);
    }

    get(key: string) {
        return this.db!.get(key);
    }

    init() {
    }

    remove(key: string) {
        this.db!.remove(key);
    }

    set(key: string, value: string) {
        this.db!.set(key, value);
    }
}
