import { isUndefined, notUndefined } from '@kdt310722/utils/common'
import { isKeysOf, isObject } from '@kdt310722/utils/object'
import { isString } from '@kdt310722/utils/string'
import type { JsonRpcError } from '../errors'
import type { JsonRpcErrorObject, JsonRpcErrorResponseMessage, JsonRpcMessage, JsonRpcNotifyMessage, JsonRpcRequestMessage, JsonRpcResponseMessage } from '../types'

export function isJsonRpcRequestMessage(message: JsonRpcMessage): message is JsonRpcRequestMessage {
    return isKeysOf(message, ['id', 'method'])
}

export function isJsonRpcMessage(message: unknown): message is JsonRpcMessage {
    return isObject(message) && message.jsonrpc === '2.0'
}

export function isJsonRpcNotifyMessage(message: JsonRpcMessage): message is JsonRpcNotifyMessage {
    return isKeysOf(message, ['method']) && isString(message.method) && !isKeysOf(message, ['id'])
}

export function isJsonRpcResponseMessage(message: JsonRpcMessage): message is JsonRpcResponseMessage {
    return isKeysOf(message, ['id'])
}

export function isJsonRpcError(message: unknown): message is JsonRpcErrorObject {
    return isObject(message) && isKeysOf(message, ['code', 'message'])
}

export function isJsonRpcErrorResponseMessage(message: JsonRpcMessage): message is JsonRpcErrorResponseMessage {
    return isKeysOf(message, ['error']) && isJsonRpcError(message.error)
}

export function createNotifyMessage(method: string, params?: any) {
    return { jsonrpc: '2.0', method, ...(isUndefined(params) ? {} : { params }) }
}

export function createRequestMessage(id: string | number, method: string, params?: any) {
    return { jsonrpc: '2.0', id, method, ...(isUndefined(params) ? {} : { params }) }
}

export function createEventMessage(event: string, data: any) {
    return createNotifyMessage('subscribe', { event, result: data })
}

export function createResponseMessage(id: number | string | null, result?: any, error?: JsonRpcError) {
    return { jsonrpc: '2.0', id, ...(notUndefined(result) ? { result } : {}), ...(notUndefined(error) ? { error: { code: error.code, message: error.message, data: error.data } } : {}) }
}

export function createErrorResponse(id: number | string | null, error: JsonRpcError) {
    return createResponseMessage(id, undefined, error)
}
