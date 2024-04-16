import { SerialDatabaseAdapter } from '.'
import { RunResult } from '../../electric/adapter'
import { Row, Statement } from '../../util'

export class MockDatabaseAdapter extends SerialDatabaseAdapter {
  readonly defaultNamespace = 'main'
  private expectRun: ((stmt: Statement) => Promise<RunResult>) | undefined
  private expectQuery: ((stmt: Statement) => Promise<Row[]>) | undefined

  constructor() {
    super()
  }

  mockRun(check: (stmt: Statement) => Promise<RunResult>) {
    this.expectRun = check
  }

  mockQuery(check: (stmt: Statement) => Promise<Row[]>) {
    this.expectQuery = check
  }

  async _run(stmt: Statement): Promise<RunResult> {
    return (
      (await this.expectRun?.(stmt)) || Promise.resolve({ rowsAffected: 0 })
    )
  }

  async _query(stmt: Statement): Promise<Row[]> {
    return (await this.expectQuery?.(stmt)) || Promise.resolve([])
  }
}
