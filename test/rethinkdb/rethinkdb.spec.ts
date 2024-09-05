import {afterAll, beforeAll, describe} from "vitest";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer} from "testcontainers";
import {test_db} from "../lib/test_lib";

describe('rethinkdb test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 7000, host: 7000 }
    ];
    let container: StartedTestContainer

    beforeAll(async () => {
        container = await new GenericContainer("rethinkdb:latest")
            .withExposedPorts(...portMappings)
            .start()
    })


    test_db('cassandra')

    afterAll(async () => {
        await container.stop()
    })
})