import {after, before, describe} from "node:test";
import {test_db} from "../lib/test_lib";
import {GenericContainer, type PortWithOptionalBinding, type StartedTestContainer, Wait} from "testcontainers";

describe('couch test', () => {
    const portMappings: PortWithOptionalBinding[] = [
        { container: 5984, host: 5984 }
    ];
    let container: StartedTestContainer | undefined;

    before(async () => {
        // CouchDB 3.5 enables [chttpd_auth_lockout] mode=enforce by default
        // (5 failed auth attempts within max_lifetime → 403/401 for the
        // rest of that window). On a fresh container with concurrent
        // ueberdb test workers we hit the threshold easily, after which
        // every request looks like an auth failure ("Account is
        // temporarily locked", surfaced by nano as "Name or password is
        // incorrect"). Mount a local.d override that switches the
        // lockout mode to "warn" so the test matrix's transient blips
        // don't lock out the whole run.
        container = await new GenericContainer("couchdb:3.5.0")
            .withExposedPorts(...portMappings)
            .withEnvironment({
                COUCHDB_USER: "ueberdb",
                COUCHDB_PASSWORD: "ueberdb",
            })
            .withCopyContentToContainer([{
                content: '[chttpd_auth_lockout]\nmode = warn\n',
                target: '/opt/couchdb/etc/local.d/disable-lockout.ini',
                mode: 0o644,
            }])
            .withWaitStrategy(Wait.forHttp('/_up', 5984).forStatusCode(200))
            .withStartupTimeout(120000)
            .start();
    }, {timeout: 180000});

    test_db('couch');

    after(async () => {
        if (container != null) {
            try {
                await container.stop();
            } catch (err) {
                console.warn('couch container stop failed:', err);
            }
        }
    });
});
