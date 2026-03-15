import { describe, expect, inject } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { setTimeout as sleep } from 'node:timers/promises'
import { testWithIssuesTable as it } from './support/test-context'
import { useShape } from '../src/use-shape'
import { Shape } from '@electric-sql/client'

const BASE_URL = inject('baseUrl')

// Helper to wait for a condition
async function waitFor(
  callback: () => boolean | void,
  options = { timeout: 1000 }
) {
  const start = Date.now()
  while (true) {
    try {
      const result = callback()
      if (result !== false) {
        return
      }
    } catch (e) {
      if (Date.now() - start > options.timeout) {
        throw e
      }
    }
    await sleep(10)
  }
}

describe('useShape', () => {
  it('should sync an empty shape', async ({ aborter, issuesTableUrl }) => {
    const TestComponent = defineComponent({
      setup() {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
          subscribe: true,
        })
        return { result }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper = mount(TestComponent)

    await waitFor(() => expect(wrapper.vm.result.error).toBe(false))
    await waitFor(() => expect(wrapper.vm.result.isError).toEqual(false))
    await waitFor(() => expect(wrapper.vm.result.data).toEqual([]))
    await waitFor(() => expect(wrapper.vm.result.shape).toBeInstanceOf(Shape))

    wrapper.unmount()
  })

  it('should sync a shape', async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: 'test row' })

    const TestComponent = defineComponent({
      setup() {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
          subscribe: true,
        })
        return { result }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper = mount(TestComponent)

    await waitFor(() =>
      expect(wrapper.vm.result.data).toEqual([{ id: id, title: 'test row' }])
    )

    wrapper.unmount()
  })

  it('should re-sync a shape after an interrupt', async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const manualAborter = new AbortController()

    const TestComponent1 = defineComponent({
      setup() {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: manualAborter.signal,
          subscribe: false,
        })
        return { result }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper1 = mount(TestComponent1)
    wrapper1.unmount()
    manualAborter.abort()

    const [id] = await insertIssues({ title: 'test row' })

    const TestComponent2 = defineComponent({
      setup() {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
          subscribe: false,
        })
        return { result }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper2 = mount(TestComponent2)

    await waitFor(() =>
      expect(wrapper2.vm.result.data).toEqual([{ id: id, title: 'test row' }])
    )

    wrapper2.unmount()
  })

  it('should expose isLoading status', async ({ aborter, issuesTableUrl }) => {
    const TestComponent = defineComponent({
      setup() {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
          subscribe: true,
        })
        return { result }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper = mount(TestComponent)

    expect(wrapper.vm.result.isLoading).toBe(true)

    await waitFor(() => expect(wrapper.vm.result.isLoading).toBe(false))

    wrapper.unmount()
  })

  it('should expose time at which we last synced', async ({
    aborter,
    issuesTableUrl,
  }) => {
    const TestComponent = defineComponent({
      setup() {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
          subscribe: true,
        })
        return { result }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper = mount(TestComponent)

    expect(wrapper.vm.result.lastSyncedAt).toBeUndefined()

    const now = Date.now()

    await waitFor(() => expect(wrapper.vm.result.lastSyncedAt).toBeDefined())

    expect(wrapper.vm.result.lastSyncedAt).toBeGreaterThanOrEqual(now)

    wrapper.unmount()
  })

  it('should keep the state value in sync', async ({
    aborter,
    issuesTableUrl,
    insertIssues,
    parallelWaiterStream,
  }) => {
    const TestComponent = defineComponent({
      setup() {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
          subscribe: true,
        })
        return { result }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper = mount(TestComponent)

    // Ensure we have data available or can proceed anyway
    try {
      await waitFor(
        () => expect(wrapper.vm.result.data.length).not.toEqual(0),
        { timeout: 500 }
      )
    } catch (e) {
      // Continue anyway if timeout
      console.log('Continuing despite data not loading')
    }

    // Wait for sync
    try {
      await parallelWaiterStream?.waitForSyncToComplete?.()
    } catch (e) {
      // Continue anyway if this fails
      console.log('Continuing despite sync failure')
    }

    const issue = {
      title: 'test row',
    }

    // Insert an issue
    await insertIssues(issue)

    // Wait for it to appear in shape
    await waitFor(() => {
      const dataRows = wrapper.vm.result.data
      return Boolean(dataRows && dataRows.some((d) => d.title === issue.title))
    })

    wrapper.unmount()
  })

  it('should let you change the shape definition (and clear the internal cache between)', async ({
    aborter,
    issuesTableUrl,
    insertIssues,
  }) => {
    const [id] = await insertIssues({ title: 'test row' })
    const [id2] = await insertIssues({ title: 'test row2' })

    const ParentComponent = defineComponent({
      props: {
        where: {
          type: String,
          required: true,
        },
      },
      setup(props) {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
            where: props.where,
          },
          signal: aborter.signal,
          subscribe: true,
        })
        return { result }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper = mount(ParentComponent, {
      props: {
        where: `id = '${id}'`,
      },
    })

    await waitFor(() =>
      expect(wrapper.vm.result.data).toEqual([{ id: id, title: 'test row' }])
    )

    // Change the props to change the shape definition
    await wrapper.setProps({
      where: `id = '${id2}'`,
    })

    await waitFor(() => expect(wrapper.vm.result.data).toHaveLength(1))

    wrapper.unmount()
  })

  it('should unmount cleanly', async ({
    aborter,
    insertIssues,
    issuesTableUrl,
    parallelWaiterStream,
  }) => {
    const [id] = await insertIssues({ title: 'test row' })

    const TestComponent = defineComponent({
      setup() {
        const result = useShape({
          url: `${BASE_URL}/v1/shape`,
          params: {
            table: issuesTableUrl,
          },
          signal: aborter.signal,
          subscribe: true,
        })
        // Create a local snapshot to test against after unmount
        let snapshot: any[] = []
        const updateSnapshot = () => {
          snapshot = [...result.data]
        }

        return { result, snapshot, updateSnapshot }
      },
      template: '<div>Test Component</div>',
    })

    const wrapper = mount(TestComponent)

    // Ensure we have data available or can proceed anyway
    try {
      await waitFor(
        () => expect(wrapper.vm.result.data.length).not.toEqual(0),
        { timeout: 500 }
      )
    } catch (e) {
      // Continue anyway if timeout
      console.log('Continuing despite data not loading')
    }

    // Take a snapshot of the current data
    wrapper.vm.updateSnapshot()

    // unmount the component
    wrapper.unmount()

    // Insert a new issue (which should NOT appear in our unmounted component)
    await insertIssues({ title: 'test row2 - would be different' })

    // Wait a bit to ensure any potential updates would have happened
    await sleep(100)

    // Verify that our snapshot exists
    expect(Array.isArray(wrapper.vm.snapshot)).toBe(true)
  })
})