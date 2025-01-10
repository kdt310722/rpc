import { isArray } from '@kdt310722/utils/array'
import { join } from '@kdt310722/utils/buffer'
import { Emitter } from '@kdt310722/utils/event'
import { tryCatch } from '@kdt310722/utils/function'
import { parseJson, stringifyJson } from '@kdt310722/utils/json'
import { type DeferredPromise, createDeferred, withTimeout } from '@kdt310722/utils/promise'
import { JsonRpcBatchRequestError, type JsonRpcError, JsonRpcRequestError } from '../errors'
import type { JsonRpcMessage, JsonRpcRequestMessage, JsonRpcResponseMessageWithNonNullId, UrlLike, WebSocketMessage } from '../types'
import { createNotifyMessage, createRequestMessage, isJsonRpcErrorResponseMessage, isJsonRpcMessage, isJsonRpcNotifyMessage, isJsonRpcResponseHasNonNullableId, isJsonRpcResponseMessage, toJsonRpcError } from '../utils'
import { WebSocketClient, type WebSocketClientOptions } from '../websocket'

export interface RpcWebsocketClientOptions extends WebSocketClientOptions {
    requestTimeout?: number
}

export type RpcWebSocketClientEvents = {
    error: (error: JsonRpcError) => void
    notification: (method: string, params?: any) => void
    unhandledMessage: (message: WebSocketMessage) => void
    unhandledRpcMessage: (message: JsonRpcMessage) => void
}

export interface PendingRequest {
    payload: JsonRpcRequestMessage
    response: DeferredPromise<any>
}

export type RequestPayload<R = any> = JsonRpcRequestMessage & { readonly __result?: R }

export class RpcWebSocketClient extends Emitter<RpcWebSocketClientEvents> {
    public readonly socket: WebSocketClient

    protected readonly requestTimeout: number
    protected readonly requests: Map<string | number, PendingRequest>

    protected requestId = 0

    public constructor(url: UrlLike, { requestTimeout = 10 * 1000, ...options }: RpcWebsocketClientOptions = {}) {
        super()

        this.requestTimeout = requestTimeout
        this.requests = new Map()
        this.socket = this.createWebSocketClient(url, options)
    }

    public async notify(method: string, params?: any) {
        return this.socket.send(stringifyJson(createNotifyMessage(method, params)))
    }

    public async call<R = any>(method: string, params?: any, id?: string | number) {
        const { payload, result } = this.createRequest(this.createRequestPayload<R>(method, params, id))

        await this.socket.send(stringifyJson(payload)).catch((error) => {
            throw new JsonRpcRequestError('Send request failed', { cause: error }).withUrl(this.socket.url).withPayload(payload)
        })

        return withTimeout(result, this.requestTimeout, () => new JsonRpcRequestError('Request timeout').withUrl(this.socket.url).withPayload(payload))
    }

    public async batchCall<T extends [RequestPayload, ...RequestPayload[]]>(payloads: T) {
        const requests = payloads.map((payload) => this.createRequest(payload))
        const data = requests.map(({ payload }) => payload)

        await this.socket.send(stringifyJson(data)).catch((error) => {
            throw new JsonRpcBatchRequestError('Send batch request failed', { cause: error }).withPayloads(data)
        })

        return await withTimeout(Promise.all(requests.map(({ result }) => result)), this.requestTimeout, () => new JsonRpcRequestError('Request timeout').withUrl(this.socket.url).withPayload(data)) as { [K in keyof T]: NonNullable<T[K]['__result']> }
    }

    public createRequestPayload<R = any>(method: string, params?: any, id?: string | number): RequestPayload<R> {
        return createRequestMessage(id ?? ++this.requestId, method, params)
    }

    protected createRequest<T extends RequestPayload>({ id, method, params }: T) {
        const response = createDeferred<NonNullable<T['__result']>>()
        const payload = createRequestMessage(id, method, params)

        this.requests.set(id, { payload, response })

        return { payload, result: response }
    }

    protected handleRpcResponse(request: PendingRequest, response: JsonRpcResponseMessageWithNonNullId) {
        if (isJsonRpcErrorResponseMessage(response)) {
            return request.response.reject(new JsonRpcRequestError('Request failed', { cause: toJsonRpcError(response.error) }).withUrl(this.socket.url).withPayload(request.payload))
        }

        return request.response.resolve(response.result)
    }

    protected handleRpcMessage(message: JsonRpcMessage) {
        if (isJsonRpcNotifyMessage(message)) {
            return this.emit('notification', message.method, message.params)
        }

        if (isJsonRpcResponseMessage(message)) {
            if (isJsonRpcResponseHasNonNullableId(message)) {
                const request = this.requests.get(message.id)

                if (request) {
                    return this.handleRpcResponse(request, message)
                }
            } else if (isJsonRpcErrorResponseMessage(message)) {
                return this.emit('error', toJsonRpcError(message.error))
            }
        }

        return this.emit('unhandledRpcMessage', message)
    }

    protected handleMessage(message: WebSocketMessage) {
        const data = tryCatch(() => parseJson(join(message)), null)

        if (isJsonRpcMessage(data)) {
            return this.handleRpcMessage(data)
        }

        if (isArray(data) && data.every(isJsonRpcMessage)) {
            for (const rpcMessage of data) {
                this.handleRpcMessage(rpcMessage)
            }

            return
        }

        return this.emit('unhandledMessage', message)
    }

    protected createWebSocketClient(url: UrlLike, options: WebSocketClientOptions) {
        const client = new WebSocketClient(url, options)

        client.on('disconnected', () => {
            for (const request of this.requests.values()) {
                if (!request.response.isSettled) {
                    request.response.reject(new JsonRpcRequestError('WebSocket disconnected').withUrl(this.socket.url).withPayload(request.payload))
                }
            }
        })

        client.on('message', (message) => {
            this.handleMessage(message)
        })

        return client
    }
}
