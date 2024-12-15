import { notNullish, notUndefined } from '@kdt310722/utils/common'
import { isKeysOf, isObject } from '@kdt310722/utils/object'
import { isString } from '@kdt310722/utils/string'
import type { JsonRpcError } from '../errors'
import type { JsonRpcErrorObject, JsonRpcErrorResponseMessage, JsonRpcMessage, JsonRpcNotifyMessage, JsonRpcRequestMessage, JsonRpcResponseId, JsonRpcResponseMessage, JsonRpcResponseMessageWithNonNullId, JsonRpcSuccessResponseMessage } from '../types'

export function isJsonRpcMessage(message: unknown): message is JsonRpcMessage {
    return isObject(message) && message.jsonrpc === '2.0'
}

export function isJsonRpcRequestMessage(message: JsonRpcMessage): message is JsonRpcRequestMessage {
    return isKeysOf(message, ['id', 'method'])
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

export function isJsonRpcResponseHasNonNullableId(response: JsonRpcResponseMessage): response is JsonRpcResponseMessageWithNonNullId {
    return notNullish(response.id)
}

export function createNotifyMessage(method: string, params?: any): JsonRpcNotifyMessage {
    return { jsonrpc: '2.0', method, ...(notUndefined(params) ? { params } : {}) }
}

export function createRequestMessage(id: string | number, method: string, params?: any): JsonRpcRequestMessage {
    return { jsonrpc: '2.0', id, method, ...(notUndefined(params) ? { params } : {}) }
}

export function createSuccessResponseMessage<R = any>(id: JsonRpcResponseId, result: R): JsonRpcSuccessResponseMessage<R> {
    return { jsonrpc: '2.0', id, result }
}

export function createErrorResponseMessage(id: JsonRpcResponseId, error: JsonRpcError): JsonRpcErrorResponseMessage {
    return { jsonrpc: '2.0', id, error: error.toJSON() }
}
