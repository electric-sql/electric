export class InvalidArgumentError extends Error {
  constructor(msg: string) {
    super(msg)
    // Set the prototype explicitly
    Object.setPrototypeOf(this, InvalidArgumentError.prototype)
    this.message = msg
  }
}
