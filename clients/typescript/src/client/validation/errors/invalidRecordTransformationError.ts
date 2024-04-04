export class InvalidRecordTransformationError extends Error {
  constructor(message: string) {
    super(message)
    // Set the prototype explicitly
    Object.setPrototypeOf(this, InvalidRecordTransformationError.prototype)
    this.message = message
  }
}
