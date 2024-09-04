import {afterAll, beforeAll, describe} from "vitest";
import {test_db} from "../lib/test_lib";
import {GenericContainer, PortWithOptionalBinding, StartedTestContainer} from "testcontainers";

describe('postgres test', ()=>{
    const portMappings: PortWithOptionalBinding[] = [
        { container: 3306, host: 3306 }
    ];
    let container: StartedTestContainer

    beforeAll(async () => {
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

    afterAll(async () => {
        if (container){
            await container.stop()
        }
    })
}, 120000)
