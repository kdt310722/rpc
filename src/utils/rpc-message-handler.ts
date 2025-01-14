import { isArray } from '@kdt310722/utils/array'
import { join } from '@kdt310722/utils/buffer'
import { isNull } from '@kdt310722/utils/common'
import { Emitter } from '@kdt310722/utils/event'
import { tap, tryCatch } from '@kdt310722/utils/function'
import { parseJson } from '@kdt310722/utils/json'
import { type Awaitable, withTimeout } from '@kdt310722/utils/promise'
import type { RawData } from 'ws'
import { JsonRpcError } from '../errors'
import type { JsonRpcMessage, JsonRpcResponseMessage, WebSocketMessage } from '../types'
import { createErrorResponseMessage, createSuccessResponseMessage, isJsonRpcMessage, isJsonRpcNotifyMessage, isJsonRpcRequestMessage } from './messages'

export type RpcMethodHandler<TContext = any> = TContext extends void | undefined ? (params: any) => Awaitable<any> : (params: any, context: TContext) => Awaitable<any>

export interface RpcMessageHandlerOptions {
    errorHandler?: (error: unknown) => any
    operationTimeout?: number
    maxBatchSize?: number
}

export type RpcMessageHandlerEvents<TContext = any> = {
    notification: TContext extends void | undefined ? (method: string, params: any) => void : (method: string, params: any, context: TContext) => void
    error: (error: unknown) => void
    unhandledMessage: TContext extends void | undefined ? (message: WebSocketMessage) => void : (message: WebSocketMessage, context: TContext) => void
}

export const RPC_NOTIFY_MESSAGE = Symbol('rpc-notify-message')

export class RpcMessageHandler<TContext = any> extends Emitter<RpcMessageHandlerEvents<TContext>, true> {
    protected readonly errorHandler: (error: unknown) => JsonRpcError
    protected readonly operationTimeout: number
    protected readonly maxBatchSize: number

    public constructor(protected readonly methods: Record<string, RpcMethodHandler<TContext>>, { errorHandler, operationTimeout = 60_000, maxBatchSize = 1000 }: RpcMessageHandlerOptions = {}) {
        super()

        this.errorHandler = errorHandler ?? ((error) => (error instanceof JsonRpcError ? error : new JsonRpcError(-32_603, 'Internal Error', { cause: error })))
        this.operationTimeout = operationTimeout
        this.maxBatchSize = maxBatchSize
    }

    public addMethod(name: string, handler: RpcMethodHandler<TContext>, override = false) {
        if (this.methods[name] && !override) {
            throw new Error(`Method ${name} already exists`)
        }

        this.methods[name] = handler
    }

    public async handleMessage(message: RawData, context?: TContext): Promise<JsonRpcResponseMessage | JsonRpcResponseMessage[] | typeof RPC_NOTIFY_MESSAGE> {
        const data = tryCatch(() => parseJson(join(message)), null)

        if (isJsonRpcMessage(data)) {
            return this.handleRpcMessage(data, context)
        }

        if (isArray(data)) {
            return this.handleRpcBatchMessage(data, context)
        }

        return tap(createErrorResponseMessage(null, isNull(data) ? new JsonRpcError(-32_700, 'Invalid JSON') : new JsonRpcError(-32_600, 'Invalid Request')), () => {
            // @ts-ignore ignore
            this.emit('unhandledMessage', message, context)
        })
    }

    protected handleRpcBatchMessage(messages: any[], context?: TContext) {
        if (messages.length > this.maxBatchSize) {
            return createErrorResponseMessage(null, new JsonRpcError(-32_600, 'Batch size exceeded'))
        }

        const responses = messages.map((message) => {
            if (!isJsonRpcMessage(message)) {
                return createErrorResponseMessage(null, new JsonRpcError(-32_600, 'Invalid Request'))
            }

            return this.handleRpcMessage(message, context)
        })

        return Promise.all(responses).then((r) => r.filter((i) => i !== RPC_NOTIFY_MESSAGE))
    }

    protected async handleRpcMessage(message: JsonRpcMessage, context?: TContext) {
        if (isJsonRpcNotifyMessage(message)) {
            // @ts-ignore ignore
            return tap(RPC_NOTIFY_MESSAGE, () => this.emit('notification', message.method, message.params, context))
        }

        if (!isJsonRpcRequestMessage(message)) {
            return createErrorResponseMessage(message.id ?? null, new JsonRpcError(-32_600, 'Invalid Request'))
        }

        const handler = this.methods[message.method]

        if (!handler) {
            return createErrorResponseMessage(message.id, new JsonRpcError(-32_601, 'Method not found'))
        }

        const response = withTimeout(Promise.resolve().then(() => handler(message.params, context!)), this.operationTimeout, () => {
            return new JsonRpcError(-32_000, 'Operation Timeout')
        })

        return response.then((r) => createSuccessResponseMessage(message.id, r)).catch((error) => tap(createErrorResponseMessage(message.id, this.errorHandler(error)), () => {
            this.emit('error', error)
        }))
    }
}
