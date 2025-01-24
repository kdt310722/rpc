import type { RawData } from 'ws'

export type UrlLike = URL | string

export type WebSocketMessage = RawData | string

export interface BaseJsonRpcMessage {
    jsonrpc: '2.0'
}

export interface JsonRpcRequestMessage extends BaseJsonRpcMessage {
    id: string | number
    method: string
    params?: any
}

export interface JsonRpcNotifyMessage extends BaseJsonRpcMessage {
    method: string
    params?: any
}

export interface JsonRpcErrorObject {
    code: number
    message: string
    data?: any
}

export type JsonRpcResponseId = string | number | null

export interface BaseJsonRpcResponseMessage extends BaseJsonRpcMessage {
    id: JsonRpcResponseId
}

export interface JsonRpcSuccessResponseMessage<R = any> extends BaseJsonRpcResponseMessage {
    result: R
}

export interface JsonRpcErrorResponseMessage extends BaseJsonRpcResponseMessage {
    error: JsonRpcErrorObject
}

export type JsonRpcResponseMessage<R = any> = JsonRpcSuccessResponseMessage<R> | JsonRpcErrorResponseMessage

export type JsonRpcResponseMessageWithNonNullId<R = any> = (Omit<JsonRpcSuccessResponseMessage<R>, 'id'> | Omit<JsonRpcErrorResponseMessage, 'id'>) & {
    id: NonNullable<JsonRpcResponseId>
}

export type JsonRpcMessage = JsonRpcRequestMessage | JsonRpcNotifyMessage | JsonRpcResponseMessage

export type DataEncoder = (data: JsonRpcMessage[] | JsonRpcMessage) => WebSocketMessage

export type DataDecoder = (data: WebSocketMessage) => JsonRpcMessage | JsonRpcMessage[]
