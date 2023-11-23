type EventMap = {
  [key: string]: (...args: any[]) => void | Promise<void>
}

/**
 * Implementation of a typed async event emitter.
 * (Asynchronous) event listeners are called in order and awaited
 * such that the next listener is called only after the previous one finished.
 * Typings are inspired by the 'typed-emitter' package.
 */
export class AsyncEventEmitter<Events extends EventMap> {
  private maxListeners = 10 // after how many listeners to print a memory leak warning
  private listeners: {
    [E in keyof Events]?: Array<Events[E]>
  } = {}

  private getListeners<E extends keyof Events>(event: E): Array<Events[E]> {
    return this.listeners[event] ?? []
  }

  private assignListeners<E extends keyof Events>(
    event: E,
    listeners: Array<Events[E]>
  ) {
    this.listeners[event] = listeners
    if (listeners.length > this.maxListeners && this.maxListeners !== 0) {
      console.warn(
        `Possible AsyncEventEmitter memory leak detected. ${listeners.length} listeners added.`
      )
    }
  }

  /**
   * Adds the listener function to the end of the listeners array for the given event.
   * No checks are made to see if the listener has already been added.
   * Multiple calls passing the same combination of event and listener will result in the listener being added, and called, multiple times.
   * @param event The event to add the listener to.
   * @param listener The listener to add.
   * @returns A reference to the AsyncEventEmitter, so that calls can be chained.
   */
  addListener<E extends keyof Events>(event: E, listener: Events[E]): this {
    const listeners = this.getListeners(event)
    listeners.push(listener)
    this.assignListeners(event, listeners)
    return this
  }

  on<E extends keyof Events>(event: E, listener: Events[E]): this {
    return this.addListener(event, listener)
  }

  /**
   * Adds the listener function to the beginning of the listeners array for the given event.
   * No checks are made to see if the listener has already been added.
   * Multiple calls passing the same combination of event and listener will result in the listener being added, and called, multiple times.
   * @param event The event to prepend the listener to.
   * @param listener The listener to prepend.
   * @returns A reference to the AsyncEventEmitter, so that calls can be chained.
   */
  prependListener<E extends keyof Events>(event: E, listener: Events[E]): this {
    const listeners = this.getListeners(event)
    listeners.unshift(listener)
    this.assignListeners(event, listeners)
    return this
  }

  /**
   * Creates a listener that wraps the provided listener.
   * On the first call, the listener removes itself
   * and then calls and awaits the provided listener.
   */
  private createOnceListener<E extends keyof Events>(
    event: E,
    listener: Events[E]
  ): Events[E] {
    const wrappedListener = async (...args: Parameters<Events[E]>) => {
      this.removeListener(event, wrappedListener as Events[E])
      await listener(...args)
    }
    return wrappedListener as Events[E]
  }

  /**
   * Adds a listener that is only called on the first event.
   */
  once<E extends keyof Events>(event: E, listener: Events[E]): this {
    const wrappedListener = this.createOnceListener(event, listener)
    return this.addListener(event, wrappedListener)
  }

  /**
   * Adds a one-time listener function for the given event to the beginning of the listeners array.
   * The next time the event is triggered, this listener is removed, and then invoked.
   * @param event The event to prepend the listener to.
   * @param listener The listener to prepend.
   * @returns A reference to the AsyncEventEmitter, so that calls can be chained.
   */
  prependOnceListener<E extends keyof Events>(
    event: E,
    listener: Events[E]
  ): this {
    const wrappedListener = this.createOnceListener(event, listener)
    return this.prependListener(event, wrappedListener)
  }

  /**
   * Emits an event to all listeners.
   * Calls and awaits each of the listeners registered for the event named `event`, in the order they were registered, passing the supplied arguments to each.
   * If the event emitter does not have at least one listener registered for the 'error' event,
   * and an 'error' event is emitted, the error is thrown.
   * @param event The event to emit.
   * @param args The arguments to pass to the listeners.
   * @returns A promise that is resolved  `true` if the event had listeners, `false` otherwise.
   */
  async emit<E extends keyof Events>(
    event: E,
    ...args: Parameters<Events[E]>
  ): Promise<boolean> {
    const listeners = this.getListeners(event)

    if (event === 'error' && listeners.length === 0) {
      throw args[0]
    }

    // while iterating through the listeners
    // the `once` listeners will remove themselves from the array of listeners
    // which causes the array to be re-indexed and the next listener to be skipped
    // (because the remaining elements where shifted one position to the left
    //  but the index we use to iterate did not take this into account).
    // Therefore, the loop adjusts the index to account for this.
    const ogLength = listeners.length
    for (let i = 0; i < ogLength; i++) {
      const currentLength = listeners.length
      const diff = ogLength - currentLength
      await listeners[i - diff](...args)
    }
    return ogLength > 0
  }

  /**
   * Removes all listeners, or those of the specified event.
   * @param event The event for which to remove all listeners.
   * @returns A reference to the AsyncEventEmitter, so that calls can be chained.
   */
  removeAllListeners<E extends keyof Events>(event?: E): this {
    if (typeof event === 'undefined') {
      // delete all listeners
      this.listeners = {}
    } else {
      delete this.listeners[event]
    }
    return this
  }

  /**
   * Removes the given event listener.
   * @param event The event for which to remove a listener.
   * @param listener The listener to remove.
   * @returns A reference to the event emitter such that calls can be chained.
   */
  removeListener<E extends keyof Events>(event: E, listener: Events[E]): this {
    const listeners = this.getListeners(event)
    const index = listeners.indexOf(listener)
    if (index !== -1) {
      listeners.splice(index, 1)
    }
    return this
  }

  /**
   * Alias for `removeListener`.
   */
  off<E extends keyof Events>(event: E, listener: Events[E]): this {
    return this.removeListener(event, listener)
  }

  /**
   * @returns An array listing the events for which the emitter has registered listeners.
   */
  eventNames(): (keyof Events | string | symbol)[] {
    return Object.keys(this.listeners)
  }

  /**
   *
   * @returns The number of listeners associated to the given event.
   */
  listenerCount<E extends keyof Events>(event: E): number {
    return this.getListeners(event).length
  }

  getMaxListeners(): number {
    return this.maxListeners
  }

  /**
   * By default AsyncEventEmitters print a warning if more than 10 listeners are added for a particular event.
   * This is a useful default that helps finding memory leaks.
   * This method modifies the limit for this specific AsyncEventEmitter instance.
   * The value can be set to Infinity (or 0) to indicate an unlimited number of listeners.
   * @param maxListeners
   * @returns A reference to the event emitter, so that calls can be chained.
   */
  setMaxListeners(maxListeners: number): this {
    this.maxListeners = maxListeners
    return this
  }
}
