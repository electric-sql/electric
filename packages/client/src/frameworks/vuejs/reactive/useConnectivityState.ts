import { UnsubscribeFunction } from '../../../notifiers'
import { createConnectivityStateSubscribeFunction } from '../../../util'
import { ConnectivityState } from '../../../util/types'
import {
  getElectricConnectivityState,
  getValidConnectivityState,
} from '../../shared'
import { injectElectricUntyped } from '../dependency-injection'
import { onUnmounted, ref, shallowRef, Ref, onBeforeMount } from 'vue'

/**
 * Observes Electric's connectivity state
 */
const useConnectivityState = (): Ref<ConnectivityState> => {
  const electric = injectElectricUntyped()
  const state = ref<ConnectivityState>(getElectricConnectivityState(electric))

  // keep track of subscriptions and unsubscribe from unused ones
  const unsubscribe = shallowRef<UnsubscribeFunction>()

  onBeforeMount(() => {
    if (electric === undefined) return
    state.value = getElectricConnectivityState(electric)
    unsubscribe.value = createConnectivityStateSubscribeFunction(
      electric.notifier
    )((newState) => (state.value = getValidConnectivityState(newState)))
  })

  onUnmounted(() => unsubscribe.value?.())

  return state
}

export default useConnectivityState
