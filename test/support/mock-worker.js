import { MockElectricWorker } from '../../src/drivers/absurd-sql/mock'
import { MockNotifier } from '../../src/notifiers/mock'
import { MockRegistry } from '../../src/satellite/mock'

// XXX These functions become available to add to an
// open database using `db.create_function`.
self.user_defined_functions = {
  addTwoNumbers: (a, b) => {
    return a + b
  },
}

const notifier = new MockNotifier('test.db')
const registry = new MockRegistry()

const ref = new MockElectricWorker(self, {
  notifier: notifier,
  registry: registry,
})
