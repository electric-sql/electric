type EventMap = {
  [key: string]: (...args: any[]) => void | Promise<void>
}

type EmittedEvent<Event, Arg> = {
  event: Event
  args: Arg[]
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

  private eventQueue: Array<
    EmittedEvent<keyof Events, Parameters<Events[keyof Events]>>
  > = []
  private processing = false // indicates whether the event queue is currently being processed

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
   * The listeners will be called in order but if they are asynchronous they may run concurrently.
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
   * The listeners will be called in order but if they are asynchronous they may run concurrently.
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
   * This synchronous method processes the queue ASYNCHRONOUSLY.
   * IMPORTANT: When this process returns, the queue may still being processed by some asynchronous listeners.
   * When all listeners (including async listeners) have finished processing the events from the queue,
   * the `this.processing` flag is set to `false`.
   *
   * If the event emitter does not have at least one listener registered for the 'error' event,
   * and an 'error' event is emitted, the error is thrown.
   */
  private processQueue() {
    this.processing = true

    const emittedEvent = this.eventQueue.shift()
    if (emittedEvent) {
      // We call all listeners and process the next event when all listeners finished.
      // The listeners are not awaited so async listeners may execute concurrently.
      // However, we only process the next event once all listeners for this event have settled
      // this ensures that async listeners for distinct events do not run concurrently.
      // If there are no other events, the recursive call will enter the else branch below
      // and mark the queue as no longer being processed.
      const { event, args } = emittedEvent
      const listeners = this.getListeners(event)

      if (event === 'error' && listeners.length === 0) {
        this.processing = false
        throw args[0]
      }

      // deep copy because once listeners mutate the `this.listeners` array as they remove themselves
      // which breaks the `map` which iterates over that same array while the contents may shift
      const ls = [...listeners]
      const listenerProms = ls.map((listener) => listener(...args))

      Promise
        // wait for all listeners to finish,
        // some may fail (i.e.return a rejected promise)
        // but that should not stop the queue from being processed
        // hence the use of `allSettled` rather than `all`
        .allSettled(listenerProms)
        .then(() => this.processQueue()) // only process the next event when all listeners have finished
    } else {
      // signal that the queue is no longer being processed
      this.processing = false
    }
  }

  /**
   * Enqueues an event to be processed by its listeners.
   * Calls each of the listeners registered for the event named `event` in order.
   * If several asynchronous listeners are registered for this event, they may run concurrently.
   * However, all (asynchronous) listeners are guaranteed to execute before the next event is processed.
   * If the `error` event is emitted and the emitter does not have at least one listener registered for it,
   * the error is thrown.
   * @param event The event to emit.
   * @param args The arguments to pass to the listeners.
   */
  enqueueEmit<E extends keyof Events>(
    event: E,
    ...args: Parameters<Events[E]>
  ) {
    this.eventQueue.push({ event, args })
    if (!this.processing) {
      this.processQueue()
    }
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
