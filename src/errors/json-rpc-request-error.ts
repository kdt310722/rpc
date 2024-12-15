import { notUndefined } from '@kdt310722/utils/common'
import type { JsonRpcRequestMessage, JsonRpcResponseMessage } from '../types'

export class JsonRpcRequestError extends Error {
    public declare readonly payload?: JsonRpcRequestMessage
    public declare readonly response?: JsonRpcResponseMessage

    public withPayload(payload?: JsonRpcRequestMessage): this {
        if (notUndefined(payload)) {
            Object.defineProperty(this, 'payload', { value: payload, writable: false, enumerable: true })
        }

        return this
    }

    public withResponse(response?: JsonRpcResponseMessage): this {
        if (notUndefined(response)) {
            Object.defineProperty(this, 'response', { value: response, writable: false, enumerable: true })
        }

        return this
    }
}
