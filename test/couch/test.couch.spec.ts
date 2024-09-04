import {afterAll, beforeAll, describe} from "vitest";
import {test_db} from "../lib/test_lib";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer} from "testcontainers";

describe('couch test', async () => {
    const portMappings: PortWithOptionalBinding[] = [
        { container: 5984, host: 5984 }
    ];

    let container = await new GenericContainer("couchdb:latest")
        .withExposedPorts(...portMappings)
        .withEnvironment({
            COUCHDB_USER: "ueberdb",
            COUCHDB_PASSWORD: "ueberdb"
        })
        .withHealthCheck({
            test: ["CMD-SHELL", "curl -f http://localhost:5984/_up || exit 1"],
            interval: 10000,
            timeout: 5000,
            retries: 5
        })
        .start()


    test_db('couch')
    afterAll(async () => {
        await container.stop()
    })
}, 60000)
