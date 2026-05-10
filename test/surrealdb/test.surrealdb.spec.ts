import {after, before, describe} from "node:test";
import {test_db} from "../lib/test_lib.ts";
import {GenericContainer, type PortWithOptionalBinding, type StartedTestContainer, Wait} from "testcontainers";
import {databases} from "../lib/databases.ts";

describe('surrealdb test', () => {
    const portMappings: PortWithOptionalBinding[] = [
        { container: 8000, host: 8000 },
    ];
    let container: StartedTestContainer | undefined;

    before(async () => {
        // Configure root credentials and start in-memory storage so the
        // ueberdb test can sign in and use it. Wait for the HTTP root to
        // respond so testcontainers doesn't return before SurrealDB is ready.
        // surrealdb client 2.0.3 requires server >= 2.1.0 < 4.0.0
        container = await new GenericContainer("surrealdb/surrealdb:v2.3.10")
            .withExposedPorts(...portMappings)
            .withCommand([
                "start",
                "--user", databases.surrealdb.user || "root",
                "--pass", databases.surrealdb.password || "root",
                "--bind", "0.0.0.0:8000",
                "memory",
            ])
            .withWaitStrategy(Wait.forHttp("/health", 8000).forStatusCode(200))
            .withStartupTimeout(120000)
            .start();
    }, {timeout: 180000});

    test_db('surrealdb');

    after(async () => {
        if (container != null) {
            try {
                await container.stop();
            } catch (err) {
                console.warn("surrealdb container stop failed:", err);
            }
        }
    });
});
