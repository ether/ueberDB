import {after, before, describe} from "node:test";
import {test_db} from "../lib/test_lib.ts";
import {GenericContainer, type PortWithOptionalBinding, type StartedTestContainer} from "testcontainers";

describe('postgres test', {timeout: 120000}, ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 3306, host: 3306 }
    ];
    let container: StartedTestContainer

    before(async () => {
        container = await new GenericContainer("mariadb:latest")
            .withExposedPorts(...portMappings)
            .withEnvironment({
                MYSQL_ROOT_PASSWORD: "password",
                MYSQL_USER: "ueberdb",
                MYSQL_PASSWORD: "ueberdb",
                MYSQL_DATABASE: "ueberdb"
            }).start()
    })

    test_db('mysql')

    after(async () => {
        if (container){
            await container.stop()
        }
    })
})
