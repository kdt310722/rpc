import { notUndefined } from '@kdt310722/utils/common'
import type { JsonRpcRequestMessage } from '../types'

export class JsonRpcBatchRequestError extends Error {
    public declare readonly payloads?: JsonRpcRequestMessage[]

    public withPayloads(payloads?: JsonRpcRequestMessage[]): this {
        if (notUndefined(payloads)) {
            Object.defineProperty(this, 'payload', { value: payloads, writable: false, enumerable: true })
        }

        return this
    }
}
