import {ToolbarInterface} from './toolbar-interface'

let toolbarApi: ToolbarInterface

export function setApi(api: ToolbarInterface) {
  toolbarApi = api
}

export function getApi(): ToolbarInterface {
  return toolbarApi
}
