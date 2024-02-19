export class MockIndexDB {
  private deleted: string[]

  constructor() {
    this.deleted = []
  }

  deleteDatabase(name: string): IDBOpenDBRequest {
    this.deleted.push(name)
    return new MockDeleteRequest() as IDBOpenDBRequest
  }

  deletedDatabases(): string[] {
    return this.deleted
  }
}

export class MockDeleteRequest {
  public onsuccess: () => void
}

export class MockLocation {
  reload(): void {}
}
