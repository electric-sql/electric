import test from "ava"

import {DatabaseAdapter} from "../../src/drivers/op-sqlite/adapter"
import {MockDatabase} from "../../src/drivers/op-sqlite/mock"


test("database adapted run works",async (t)=>{
    const db = new MockDatabase("test.db")
    const adapter = new DatabaseAdapter(db)

    const sql = "select * from electric"
    const result = await adapter._run({sql})
    t.is(result.rowsAffected,1)
})

test('database adapter query works',async (t)=>{
    const db = new MockDatabase("test.db")
    const adapter = new DatabaseAdapter(db)
    
    const sql = "select * from electric"
    const result =await adapter._query({sql})
    t.deepEqual(result,[{
                column1:"text1",
                column2:"text2"
            }]
            
    )
})


test('database adapter execute batch works',async (t)=>{
    const db = new MockDatabase("test.db")
    const adapter = new DatabaseAdapter(db)

    const sql = [{sql:"select * from electric;",args:[]},{sql:"select * from opsqlite",args:[]}]
    const result=await adapter.execBatch(sql)

    t.is(result.rowsAffected,1)
})