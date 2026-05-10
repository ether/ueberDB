import {before, it} from "node:test";
import assert from "node:assert/strict";
import os from "os";
import Database from "../../index";


const TEST = `${os.tmpdir()}/ueberdb-test-${new Date().getTime()}.db`

let db: Database
before(async () => {
    db = new Database('rustydb', {
        filename: TEST
    })
    await db.init()
})




it('test get', async () => {
    db.set('key:test', 'value:test')
    let res = await db.get('key:test');
    assert.strictEqual(res, 'value:test')
    db.remove("key:test")
    assert.strictEqual(await db.get('key:test'), null)
})

it('test remove', async () => {
    db.set('key:test', 'value:test')
    db.remove('key:test')
    assert.strictEqual(await db.get('key:test'), null)
})

it('Key value set', async () => {
    db.set('key:test', 'value:test')
    let res = await db.get('key:test')
    assert.strictEqual(res, 'value:test')
})

it('Key value remove', async () => {
    db.set('key:test', 'value:test')
    db.remove('key:test')
    let res = await db.get('key:test')
    assert.strictEqual(res, null)
})


it('Key value findKeys 2', async () => {
    db.set('key:test', 'value:test')
    db.set('key:test2', 'value:test2')
    db.set('key:123', "value:123")
    let res = await db.findKeys('key:test*')
    assert.deepStrictEqual(res, ['key:test', 'key:test2'])
})

it('Key value findKeys', async () => {
    db.set('key:test', 'value:test')
    db.set('key:test2', 'value:test2')
    db.set('key:123', "value:123")
    let res = await db.findKeys('key:test2*')
    assert.deepStrictEqual(res, ['key:test2'])
})

it('Key value findKeys rev', async () => {
    db.set('key:2:test', 'value:test')
    db.set('key:3:test2', 'value:test2')
    db.set('key:4:123', "value:123")
    let res = await db.findKeys('key:*:test')
    assert.deepStrictEqual(res, ['key:2:test'])
})

it('Key value findKeys none', async () => {
    db.set('key:2:test', 'value:test')
    db.set('key:3:test2', 'value:test2')
    db.set('key:4:123', "value:123")
    let res = await db.findKeys('key:*5:test')
    assert.deepStrictEqual(res, [])
})

it('Key value findKeys 45', async () => {
    db.set('key:2:test', 'value:test')
    db.set('key:3:test2', 'value:test2')
    db.set('key:4:123', "value:123")
    db.set('key:45:test', "value:123")
    let res = await db.findKeys('key:*5:test')
    assert.deepStrictEqual(res, ["key:45:test"])
})


it('findKeys with exclusion works', async () => {
    db.set('key:2:test', 'test')
    db.set('key:2:testa', 'true')
    db.set('key:2:testb', 'true')
    db.set('key:2:testb2', 'true')
    db.set('nonmatching_key:2:test', 'true')
    const keys = await db.findKeys('key:2:test*', "key:2:testb*")
    assert.deepStrictEqual(keys.sort(), ['key:2:test', 'key:2:testa'])
})


it('findKeys with no matches works', async ()=>{

    db.set('key:2:test','test')
    const keys = await db.findKeys('123', "key:2:testb*")
    assert.deepStrictEqual(keys, [])
})


it('find keys with no wildcards works', async ()=>{
    db.set('key:2:test','')
    db.set('key:2:testa', '')
    const keys = await db.findKeys('key:2:testa')
    assert.deepStrictEqual(keys, ['key:2:testa'])
})

it('Set string with whitespace', async () => {
    db.set('my-custom-key ', 'value')
    const val = await db.get('my-custom-key ')
    assert.deepStrictEqual(val, 'value')
})

it('get without table', async ()=>{

    db.get('234dsfsdfsdf')
})
