import {afterAll, beforeAll, describe} from "vitest";
import {test_db} from "../lib/test_lib";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer} from "testcontainers";

describe('elasticsearch test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 9200, host: 9200 }
    ];
    let container: StartedTestContainer

    beforeAll(async () => {
        container = await new GenericContainer("elasticsearch:7.17.3")
            .withEnvironment({
                "discovery.type": "single-node"
            })
            .withExposedPorts(...portMappings)
            .start()
    }, 120000)

    test_db('elasticsearch')


    afterAll(async () => {
        await container.stop()
    })
})
