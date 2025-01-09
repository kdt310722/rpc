import { notUndefined } from '@kdt310722/utils/common'
import type { JsonRpcRequestMessage, JsonRpcResponseMessage } from '../types'

export class JsonRpcRequestError extends Error {
    public declare readonly url?: string
    public declare readonly payload?: JsonRpcRequestMessage | JsonRpcRequestMessage[]
    public declare readonly response?: JsonRpcResponseMessage

    public withUrl(url?: string): this {
        if (notUndefined(url)) {
            Object.defineProperty(this, 'url', { value: url, writable: false, enumerable: true })
        }

        return this
    }

    public withPayload(payload?: JsonRpcRequestMessage | JsonRpcRequestMessage[]): this {
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
