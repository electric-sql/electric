interface ILeaderWorker extends Worker {
  onnewleader: ((this: Worker, ev: MessageEvent) => any) | null
  onelection: ((this: Worker, ev: MessageEvent) => any) | null
}

export class LeaderWorker extends Worker implements ILeaderWorker {
  public onnewleader: ((this: Worker, ev: MessageEvent) => any) | null = null
  public onelection: ((this: Worker, ev: MessageEvent) => any) | null = null

  constructor(
    scriptUrl: string | URL,
    public coordinationKey: string,
    options?: WorkerOptions
  ) {
    super(scriptUrl, options)
    this.addEventListener('message', this.customEventHandler.bind(this))
    this.postMessage({ type: 'init', coordinationKey })
  }

  private customEventHandler(event: MessageEvent) {
    switch (event.data.type) {
      case 'onnewleader':
        return this.onnewleader?.(event)
    }
  }
}
