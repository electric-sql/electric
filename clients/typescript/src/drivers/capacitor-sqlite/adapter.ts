import { SQLiteDBConnection, capSQLiteChanges } from '@capacitor-community/sqlite'
import {
  DatabaseAdapter as DatabaseAdapterInterface,
  RunResult,
  TableNameImpl,
  Transaction as Tx,
} from '../../electric/adapter'
import { Row, SqlValue, Statement } from '../../util'
import { rowsFromResults } from '../util/results'
import { Database } from './database'

export class DatabaseAdapter
  extends TableNameImpl
  implements DatabaseAdapterInterface
{
  constructor(public db: Database) {
    super()
  }

  run({ sql, args }: Statement): Promise<RunResult> {
    if (args && !Array.isArray(args)) {
      throw new Error(
        `capacitor-sqlite doesn't support named query parameters, use positional parameters instead`
      )
    }

    const wrapInTransaction = true; // Default. Not sure what electric is expecting here. Also unsure if true means implicit transaction.

    return this.db.run(sql,args,wrapInTransaction).then((result: capSQLiteChanges) => {
			// TODO: unsure how capacitor-sqlite populates the changes value, and what is expected of electric here.
      const rowsAffected = result.changes?.changes ?? 0;
			return { rowsAffected };
		});
  }

  runInTransaction(...statements: Statement[]): Promise<RunResult> {
    if (statements.some((x) => x.args && !Array.isArray(x.args))) {
      throw new Error(
        `capacitor-sqlite doesn't support named query parameters, use positional parameters instead`
      );
    }

    const txn = statements.map( ({sql, args}) => ({statement: sql, args }));

     return this.db.executeTransaction(txn).then( (result: capSQLiteChanges) => {
        // TODO: unsure how capacitor-sqlite populates the changes value, and what is expected of electric here.
        const rowsAffected = result.changes?.changes ?? 0;
        return { rowsAffected };
		});
  }

  query({ sql, args }: Statement): Promise<Row[]> {
    if (args && !Array.isArray(args)) {
      throw new Error(
        `cordova-sqlite-storage doesn't support named query parameters, use positional parameters instead`
      )
    }

    return this.db.query(sql, args).then( (result) => {
      // TODO: verify compatibility
      return result.values ?? [];
    });
  }

  transaction<T>(
    f: (_tx: Tx, setResult: (res: T) => void) => void
  ): Promise<T> {
    const wrappedTx = new WrappedTx(this);

    return new Promise<T>( (resolve,reject) => {
      f(wrappedTx, (res) => {
        resolve(res);
      });
    });
  }
}

class WrappedTx implements Tx {
  constructor(private adapter: DatabaseAdapter) {}

  run(
    statement: Statement,
    successCallback?: (tx: Tx, res: RunResult) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.adapter.run(statement).then( (runResult) => {
      if (typeof successCallback !== 'undefined') {
        successCallback(this, runResult)
      }
    }).catch( (err) => {
      if (typeof errorCallback !== 'undefined') {
        errorCallback(err);
      }
    });
  }

  query(
    statement: Statement,
    successCallback: (tx: Tx, res: Row[]) => void,
    errorCallback?: (error: any) => void
  ): void {
    this.adapter.query(statement).then( (result) => {
      if (typeof successCallback !== 'undefined') {
        successCallback(this, result)
      }
    }).catch( (err) => {
      if (typeof errorCallback !== 'undefined') {
        errorCallback(err);
      }
    });
  }
}
