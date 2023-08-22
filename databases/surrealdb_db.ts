import {Surreal} from 'surrealdb.js'
import AbstractDatabase, {Settings} from "../lib/AbstractDatabase";

type VarType = {
    key: string
    notKey?: string
}
export const Database = class SurrealDB extends AbstractDatabase{
    private db: Surreal | undefined;
    private static readonly TABLE = "STORE";

    constructor(settings:Settings) {
        super();
        this.settings = settings;
         this.db = new Surreal(this.settings.url);
    }

    async init() {
        try {
            await this.db!.signin({
                user: this.settings.user!,
                pass: this.settings.password!,
            })
            await this.db!.use({db: this.settings.url, ns: this.settings.clientOptions.ns})
            await this.db!.create(Database.TABLE)
            console.log("Database initialized")
        }
        catch (e) {
            console.log(e)
        }
    }

    async get(key:string, callback: (err: Error | null, value: any)=>{}){
        console.log("Get key", key)
        const vars:Record<string, string> = {
            key: key
        }
        await this.db!.query("SELECT * FROM " + Database.TABLE + " WHERE key = $key", vars)
            .then((result) => {
                callback(null, result[0].result);
            })
            .catch((e)=>callback(e, null))
    }

    findKeys(key:string, notKey:string, callback:(v:any, keys:string[])=>{}) {
        const vars:VarType  = {key: key}
        let query = "SELECT * FROM " + Database.TABLE + " WHERE key LIKE $key"
        if (notKey != null) {
            // not desired keys are notKey:%, e.g. %:%:%
            notKey = notKey.replace(/\*/g, '%');
            query += ' AND key NOT LIKE notKey';
            vars.notKey = notKey;
        }

        this.db!.query(query, vars)
            .then((result) => {
                const keys:string[] = [];
                for (let i = 0; i < result.length; i++) {
                    keys.push(result[i].result! as string);
                }
                callback(null, keys);
            })
    }

    async set(key:string, value:string) {
        const vars:Record<string, string> = {
            key: key,
            value: value
        }
        await this.db!.query("INSERT INTO " + Database.TABLE + " (key, value) VALUES ($key, $value)", vars)
    }

    async remove(key:string) {
        await this.db!.delete(this.settings.db+":"+key)
    }

    async close() {
        await this.db!.close()
    }
}
