import {after, before, describe, it} from "node:test";
import {db, test_db} from "../lib/test_lib";
import {GenericContainer, type PortWithOptionalBinding, type StartedTestContainer} from "testcontainers";
import {databases} from "../lib/databases";
import * as ueberdb from "../../index";
import {equal} from "assert";

describe('postgres test', {timeout: 1200000}, async () => {
    const portMappings: PortWithOptionalBinding[] = [
        { container: 5432, host: 5432 }
    ];
    let container: StartedTestContainer

    before(async () => {
        container = await new GenericContainer("postgres:alpine3.21")
            .withExposedPorts(...portMappings)
            .withEnvironment({
                POSTGRES_USER: "ueberdb",
                POSTGRES_PASSWORD: "ueberdb",
                POSTGRES_DB: "ueberdb"
            }).start()
    })


    test_db('postgres')


    after(async () => {
        db.close()
        await container.stop()
    })
})

describe('postgres test individual', {timeout: 120000}, async () => {
    const portMappings: PortWithOptionalBinding[] = [
        { container: 5432, host: 5444 }
    ];
    let container: StartedTestContainer

    before(async () => {
        container = await new GenericContainer("postgres:alpine3.21")
            .withExposedPorts(...portMappings)
            .withHealthCheck({
                test: ["CMD-SHELL", "pg_isready -d postgresql://ueberdb:ueberdb@127.0.0.1/ueberdb"],
                interval: 10000,
                timeout: 5000,
                retries: 5
            })
            .withEnvironment({
                POSTGRES_USER: "ueberdb",
                POSTGRES_PASSWORD: "ueberdb",
                POSTGRES_DB: "ueberdb"
            }).start()
    })

    it('connection string instead of settings object', async () => {
        const {user, password, host, database} = databases.postgres;

        console.log(`postgres://${user}:${password}@${host}:5444/${database}`);
        const db = new ueberdb.Database('postgres', `postgres://${user}:${password}@${host}:5444/${database}`);
        await db.init();
        await db.set('key', 'val');
        const val = await db.get('key') as string;
        equal(val, 'val');
        db.close()
    });

    after(async () => {
        await container.stop()
    })

})
