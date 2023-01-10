import { MockElectricWorker } from '../../src/drivers/absurd-sql/mock'
import { WorkerBridgeNotifier } from '../../src/notifiers/bridge'

const workerServer = new MockElectricWorker(self, {})
const bridgeNotifier = new WorkerBridgeNotifier('test.db', workerServer)
workerServer.opts = { notifier: bridgeNotifier }
