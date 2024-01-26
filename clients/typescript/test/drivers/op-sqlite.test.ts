import test from "ava"

import {DatabaseAdapter} from "../../src/drivers/op-sqlite/adapter"
import {MockDatabase} from "../../src/drivers/op-sqlite/mock"
import { QualifiedTablename } from "../../src/util/tablename"


test('database adapter run works',async (t)=>{
    const db = new MockDatabase("test.db")
    const adapter = new DatabaseAdapter(db)
    
    const sql = "drop table badgers"
    const result = adapter._run({sql})

    t.is((await result).rowsAffected,1)
    t.deepEqual(result,{
        rowsAffected:1,
        rows:{
            _array : [{
                column1:"text1",
                column2:"text2"
            }],
            length:1,
            item:(idx:number)=>1
        }
    })
})


test('database adapter execute batch works',async (t)=>{
    const db = new MockDatabase("test.db")
    const adapter = new DatabaseAdapter(db)

    const sql = "select * from bars;"
    const result= db.execute(sql)

    t.is(result.rowsAffected,1)
})