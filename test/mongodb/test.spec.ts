import {after, before, describe} from "node:test";
import {test_db} from "../lib/test_lib.ts";
import {GenericContainer, type PortWithOptionalBinding, type StartedTestContainer} from "testcontainers";

describe('mongo test', {timeout: 120000}, () => {
    const portMappings: PortWithOptionalBinding[] = [
        {container: 27017, host: 27017}
    ];
    let container: StartedTestContainer

    before(async () => {
        container = await new GenericContainer("mongo:latest")
            .withExposedPorts(...portMappings)
            .start()
    })

    test_db('mongodb')

    after(async () => {
        await container.stop()
    })
})
