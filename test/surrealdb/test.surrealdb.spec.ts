import {afterAll, beforeAll, describe} from "vitest";
import {test_db} from "../lib/test_lib";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer} from "testcontainers";

describe('surrealdb test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 8000, host: 8000 }
    ];
    let container: StartedTestContainer

    beforeAll(async () => {
        container = await new GenericContainer("surrealdb:latest")
            .withExposedPorts(...portMappings)
            .withEnvironment({
                POSTGRES_USER: "ueberdb",
                POSTGRES_PASSWORD: "ueberdb",
                POSTGRES_DB: "ueberdb"
            }).start()
    })


    test_db('surrealdb')

    afterAll(async () => {
        await container.stop()
    })
})
