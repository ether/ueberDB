import {after, before, describe} from "node:test";
import {test_db} from "../lib/test_lib";
import {GenericContainer, type PortWithOptionalBinding, type StartedTestContainer} from "testcontainers";

describe('redis test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 6379, host: 6379 }
    ];
    let container: StartedTestContainer

    before(async () => {
        container = await new GenericContainer("redis:bookworm")
            .withExposedPorts(...portMappings)
            .start()
    })


    after(async () => {
        await container.stop()
    })
    test_db('redis')
})
