import AbstractDatabase from "../lib/AbstractDatabase";

export default class Rusty_db extends AbstractDatabase {
    db: any | null | undefined


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
        let RUSTY_DB
        try {
            RUSTY_DB = await import('rusty-store-kv');
        } catch (err) {
            throw new Error(
                'better-sqlite3 not found. It was removed from ueberdb\'s dependencies because it requires ' +
                'compilation which fails on several systems. If you still want to use sqlite, run ' +
                '"npm install better-sqlite3" in your etherpad-lite ./src directory.');
        }
        this.db = new RUSTY_DB.KeyValueDB(this.settings.filename!);
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
