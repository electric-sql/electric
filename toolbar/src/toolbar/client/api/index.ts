import {ToolbarApiBase} from "./api-base";

let toolbar_api: ToolbarApiBase;

export function setApi(api: ToolbarApiBase){
    toolbar_api = api
}

export function getApi(): ToolbarApiBase {
    return toolbar_api;
}

