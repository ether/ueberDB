import {afterAll, beforeAll, describe} from "vitest";
import {test_db} from "../lib/test_lib";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer} from "testcontainers";

describe('cassandra test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 9042, host: 9042 },
        {container: 10000, host: 10000}
    ];
    let container: StartedTestContainer

    beforeAll(async () => {
        container = await new GenericContainer("scylladb/scylla:latest")
            .withCommand([" --smp 1"])
            .withExposedPorts(...portMappings)
            .start()
    })


    test_db('cassandra')

    afterAll(async () => {
        await container.stop()
    })
})
