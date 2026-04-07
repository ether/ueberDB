import {afterAll, beforeAll, describe} from "vitest";
import {test_db} from "../lib/test_lib";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer, Wait} from "testcontainers";
import {databases} from "../lib/databases";

describe('surrealdb test', () => {
    const portMappings: PortWithOptionalBinding[] = [
        { container: 8000, host: 8000 },
    ];
    let container: StartedTestContainer | undefined;

    beforeAll(async () => {
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
    }, 180000);

    test_db('surrealdb');

    afterAll(async () => {
        if (container != null) {
            try {
                await container.stop();
            } catch (err) {
                console.warn("surrealdb container stop failed:", err);
            }
        }
    });
});
