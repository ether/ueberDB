import {beforeAll, expect, test} from "vitest";
import os from "os";
import Rusty_db from "../../databases/rusty_db";
import Database from "../../index";


const TEST = `${os.tmpdir()}/ueberdb-test-${new Date().getTime()}.db`

let db: Database
beforeAll(async () => {
    db = new Database('rustydb', {
        filename: TEST
    })
    await db.init()
})




test('test get', async () => {
    db.set('key:test', 'value:test')
    let res = await db.get('key:test');
    expect(res).toBe('value:test')
    db.remove("key:test")
    expect(await db.get('key:test')).toBeNull()
})

test('test remove', async () => {
    db.set('key:test', 'value:test')
    db.remove('key:test')
    expect(await db.get('key:test')).toBeNull()
})

test('Key value set', async () => {
    db.set('key:test', 'value:test')
    let res = await db.get('key:test')
    expect(res).toBe('value:test')
})

test('Key value remove', async () => {
    db.set('key:test', 'value:test')
    db.remove('key:test')
    let res = await db.get('key:test')
    expect(res).toBeNull()
})


test('Key value findKeys 2', async () => {
    db.set('key:test', 'value:test')
    db.set('key:test2', 'value:test2')
    db.set('key:123', "value:123")
    let res = await db.findKeys('key:test*')
    expect(res).toEqual(['key:test', 'key:test2'])
})

test('Key value findKeys', async () => {
    db.set('key:test', 'value:test')
    db.set('key:test2', 'value:test2')
    db.set('key:123', "value:123")
    let res = await db.findKeys('key:test2*')
    expect(res).toEqual(['key:test2'])
})

test('Key value findKeys rev', async () => {
    db.set('key:2:test', 'value:test')
    db.set('key:3:test2', 'value:test2')
    db.set('key:4:123', "value:123")
    let res = await db.findKeys('key:*:test')
    expect(res).toEqual(['key:2:test'])
})

test('Key value findKeys none', async () => {
    db.set('key:2:test', 'value:test')
    db.set('key:3:test2', 'value:test2')
    db.set('key:4:123', "value:123")
    let res = await db.findKeys('key:*5:test')
    expect(res).toEqual([])
})

test('Key value findKeys 45', async () => {
    db.set('key:2:test', 'value:test')
    db.set('key:3:test2', 'value:test2')
    db.set('key:4:123', "value:123")
    db.set('key:45:test', "value:123")
    let res = await db.findKeys('key:*5:test')
    expect(res).toEqual(["key:45:test"])
})


test('findKeys with exclusion works', async () => {
    db.set('key:2:test', 'test')
    db.set('key:2:testa', 'true')
    db.set('key:2:testb', 'true')
    db.set('key:2:testb2', 'true')
    db.set('nonmatching_key:2:test', 'true')
    const keys = await db.findKeys('key:2:test*', "key:2:testb*")
    expect(keys.sort()).toStrictEqual(['key:2:test', 'key:2:testa'])
})


test('findKeys with no matches works', async ()=>{

    db.set('key:2:test','test')
    const keys = await db.findKeys('123', "key:2:testb*")
    expect(keys).toStrictEqual([])
})


test('find keys with no wildcards works', async ()=>{
    db.set('key:2:test','')
    db.set('key:2:testa', '')
    const keys = await db.findKeys('key:2:testa')
    expect(keys).toStrictEqual(['key:2:testa'])
})

test('Set string with whitespace', async () => {
    db.set('my-custom-key ', 'value')
    const val = await db.get('my-custom-key ')
    expect(val).toEqual('value')
})

test('get without table', async ()=>{

    db.get('234dsfsdfsdf')
})
