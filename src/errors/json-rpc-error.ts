import { notUndefined } from '@kdt310722/utils/common'
import type { JsonRpcErrorObject, JsonRpcResponseId } from '../types'
import { createErrorResponseMessage } from '../utils'

export class JsonRpcError extends Error {
    public declare readonly data?: any

    public constructor(public readonly code: number, message: string, options?: ErrorOptions) {
        super(message, options)
    }

    public withData(data?: any): this {
        if (notUndefined(data)) {
            Object.defineProperty(this, 'data', { value: data, writable: false, enumerable: true })
        }

        return this
    }

    public toJSON(): JsonRpcErrorObject {
        return { code: this.code, message: this.message, ...(notUndefined(this.data) ? { data: this.data } : {}) }
    }

    public toResponse(id: JsonRpcResponseId) {
        return createErrorResponseMessage(id, this)
    }
}
