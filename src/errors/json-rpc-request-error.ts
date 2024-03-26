import type { AnyObject } from '@kdt310722/utils/object'
import type { JsonRpcResponseMessage } from '../types'

export interface JsonRpcRequestErrorOptions extends ErrorOptions {
    code?: number
    url?: string
    payload?: AnyObject
    response?: JsonRpcResponseMessage
}

export class JsonRpcRequestError extends Error {
    public declare code?: string | number
    public declare url?: string
    public declare payload?: AnyObject
    public declare response?: JsonRpcResponseMessage

    public constructor(message?: string, options: JsonRpcRequestErrorOptions = {}) {
        super(message, options)

        Object.defineProperties(this, {
            code: { value: options.code, enumerable: true },
            url: { value: options.url, enumerable: true },
            payload: { value: options.payload, enumerable: true },
            response: { value: options.response, enumerable: true },
        })
    }
}
