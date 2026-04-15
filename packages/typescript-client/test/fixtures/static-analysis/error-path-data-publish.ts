class ShapeStream {
  async run(): Promise<void> {
    try {
      await this.#fetch()
    } catch (e) {
      // BUG shape: publishing a data row (not a control message) inside a
      // catch block. The error-path-publish rule must flag this.
      await this.#publish([
        {
          offset: `1_0`,
          value: { id: 1 },
          headers: { operation: `insert` },
          key: `k`,
        },
      ])
      throw e
    }
  }

  async #fetch(): Promise<void> {}
  async #publish(_msgs: unknown[]): Promise<void> {}
}

void ShapeStream
