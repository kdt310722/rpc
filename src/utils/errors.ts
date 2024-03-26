import { JsonRpcError } from '../errors'
import type { JsonRpcErrorObject } from '../types'

export function toJsonRpcError(error: JsonRpcErrorObject, options?: ErrorOptions) {
    return new JsonRpcError(error.code, error.message, error.data, options)
}
