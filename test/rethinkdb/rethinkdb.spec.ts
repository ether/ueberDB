import {after, before, describe} from "node:test";
import {GenericContainer, type PortWithOptionalBinding, type StartedTestContainer} from "testcontainers";
import {test_db} from "../lib/test_lib.ts";

describe('rethinkdb test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 7000, host: 7000 }
    ];
    let container: StartedTestContainer

    before(async () => {
        container = await new GenericContainer("rethinkdb:latest")
            .withExposedPorts(...portMappings)
            .start()
    })


    test_db('cassandra')

    after(async () => {
        await container.stop()
    })
})
