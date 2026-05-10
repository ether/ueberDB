import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        testTimeout: 120000,
        hookTimeout: 120000,
        // Integration tests against real DB containers are inherently
        // flaky on shared CI runners (network blips, slow startup,
        // intermittent connection resets, especially the nano + CouchDB
        // 3.5 stack which intermittently returns 401 from session
        // middleware on the first request after a fresh connection).
        // Retry up to 5 times before giving up so transient blips don't
        // fail the whole job. The underlying bug still surfaces if the
        // test fails consistently.
        retry: 5,
    }
})
