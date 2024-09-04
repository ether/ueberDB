import {afterAll, beforeAll, describe} from "vitest";
import {test_db} from "../lib/test_lib";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer} from "testcontainers";

describe('redis test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 6379, host: 6379 }
    ];
    let container: StartedTestContainer

    beforeAll(async () => {
        container = await new GenericContainer("redis:latest")
            .withExposedPorts(...portMappings)
            .start()
    })


    afterAll(async () => {
        await container.stop()
    })
    test_db('redis')
})
