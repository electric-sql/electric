import { BatchQueryResult, QueryResult, SQLBatchTuple } from "@op-engineering/op-sqlite";
import { DbName } from "../../util/types";
import { Database } from "./database";

export class MockDatabase implements Database {
    constructor(public dbname: DbName, public fail?:Error){}

    execute(query: string, params?: any[] | undefined): QueryResult{
        return {
            rowsAffected:1,
            rows:{
                _array : [{
                    column1:"text1",
                    column2:"text2"
                }],
                length:1,
                item:(idx:number)=>1
            }
        }
    };  
    executeBatch(commands: SQLBatchTuple[]): BatchQueryResult{
        return {rowsAffected:1}
    }
}