import {afterAll, beforeAll, describe} from "vitest";
import {test_db} from "../lib/test_lib";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer} from "testcontainers";

describe('mongo test', async () => {
    const portMappings: PortWithOptionalBinding[] = [
        {container: 27017, host: 27017}
    ];
    let container: StartedTestContainer

    container = await new GenericContainer("mongo:latest")
        .withExposedPorts(...portMappings)
        .start()
    test_db('mongodb')

    afterAll(async () => {
        await container.stop()
    })
}, 120000)
