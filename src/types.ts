export type UrlLike = URL | string

export type WebSocketMessage = ArrayBuffer | Buffer | string

export type DataEncoder = (data: any) => WebSocketMessage

export type DataDecoder = (data: WebSocketMessage) => any

export interface JsonRpcMessage {
    jsonrpc: '2.0'
}

export interface JsonRpcRequestMessage extends JsonRpcMessage {
    id: string | number
    method: string
    params?: any
}

export interface JsonRpcNotifyMessage extends JsonRpcMessage {
    method: string
    params?: any
}

export interface JsonRpcErrorObject {
    code: number
    message: string
    data?: any
}

export interface BaseJsonRpcResponseMessage extends JsonRpcMessage {
    id: string | number
}

export interface JsonRpcSuccessResponseMessage<R = any> extends BaseJsonRpcResponseMessage {
    result: R
}

export interface JsonRpcErrorResponseMessage extends BaseJsonRpcResponseMessage {
    error: JsonRpcErrorObject
}

export type JsonRpcResponseMessage<R = any> = JsonRpcSuccessResponseMessage<R> | JsonRpcErrorResponseMessage
