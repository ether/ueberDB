import {after, before, describe} from "node:test";
import {test_db} from "../lib/test_lib";
import {GenericContainer, type PortWithOptionalBinding, type StartedTestContainer} from "testcontainers";

describe('cassandra test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 9042, host: 9042 },
        {container: 10000, host: 10000}
    ];
    let container: StartedTestContainer

    before(async () => {
        container = await new GenericContainer("scylladb/scylla:2025.3")
            .withCommand([" --smp 1"])
            .withExposedPorts(...portMappings)
            .start()
    })


    test_db('cassandra')

    after(async () => {
        await container.stop()
    })
})
