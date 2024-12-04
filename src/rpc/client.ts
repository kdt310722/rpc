import { isArray } from '@kdt310722/utils/array'
import { join } from '@kdt310722/utils/buffer'
import { notUndefined } from '@kdt310722/utils/common'
import { Emitter } from '@kdt310722/utils/event'
import { tap, tryCatch } from '@kdt310722/utils/function'
import { isKeysOf } from '@kdt310722/utils/object'
import { type DeferredPromise, createDeferred, withTimeout } from '@kdt310722/utils/promise'
import { isString } from '@kdt310722/utils/string'
import { type JsonRpcError, JsonRpcRequestError, WebsocketClientError } from '../errors'
import type { DataDecoder, DataEncoder, JsonRpcResponseMessage, UrlLike, WebSocketMessage } from '../types'
import { createNotifyMessage, createRequestMessage, createResponseMessage, isJsonRpcError, isJsonRpcErrorResponseMessage, isJsonRpcMessage, isJsonRpcNotifyMessage, isJsonRpcRequestMessage, isJsonRpcResponseMessage, toJsonRpcError } from '../utils'
import type { WebSocketClientEvents, WebSocketClientOptions } from '../websocket'
import { WebSocketClient } from '../websocket'

export interface RpcWebSocketClientOptions extends WebSocketClientOptions {
    autoResubscribe?: boolean
    requestTimeout?: number
    dataEncoder?: DataEncoder
    dataDecoder?: DataDecoder
}

export type RpcClientEvents = Omit<WebSocketClientEvents, 'message'> & {
    'unknown-message': (message: WebSocketMessage) => void
    'rpc-error': (error: JsonRpcError) => void
    'notify': (method: string, params?: any) => void
}

export class RpcWebSocketClient extends Emitter<RpcClientEvents> {
    protected readonly client: WebSocketClient
    protected readonly autoResubscribe: boolean
    protected readonly requestTimeout: number
    protected readonly requests: Record<number | string, DeferredPromise<JsonRpcResponseMessage>>
    protected readonly dataEncoder: DataEncoder
    protected readonly dataDecoder: DataDecoder
    protected readonly subscriptions: Map<string, any>

    protected incrementId = 0

    public constructor(url: UrlLike, options: RpcWebSocketClientOptions = {}) {
        super()

        const { autoResubscribe = true, requestTimeout = 10_000, dataEncoder, dataDecoder, ...clientOptions } = options

        this.autoResubscribe = autoResubscribe
        this.requestTimeout = requestTimeout
        this.requests = {}
        this.subscriptions = new Map()
        this.dataEncoder = dataEncoder ?? JSON.stringify
        this.dataDecoder = dataDecoder ?? ((data) => JSON.parse(join(data)))

        this.client = this.registerClientEvents(new WebSocketClient(url, {
            ...clientOptions,
            heartbeatMessage: clientOptions.heartbeatMessage ?? this.dataEncoder(createRequestMessage('ping', 'ping')),
        }))
    }

    public get url() {
        return this.client.url
    }

    public async connect() {
        return this.client.connect()
    }

    public disconnect(code?: number, reason?: string) {
        this.client.disconnect(code, reason)
    }

    public notify(method: string, params?: any) {
        this.client.send(this.dataEncoder(createNotifyMessage(method, params)))
    }

    public async subscribe(event: string, params?: any) {
        const result = await this.call('subscribe', [event, params].filter(notUndefined))

        if (!result) {
            throw Object.assign(new JsonRpcRequestError('Subscribe failed', { url: this.url }), { event, params, result })
        }

        this.subscriptions.set(event, params)

        return () => this.unsubscribe(event)
    }

    public async unsubscribe(event: string) {
        const result = await this.call('unsubscribe', [event])

        if (!result) {
            throw Object.assign(new JsonRpcRequestError('Unsubscribe failed', { url: this.url }), { event, result })
        }

        this.subscriptions.delete(event)
    }

    public async call<R = any>(method: string, params?: any, id?: string | number) {
        const { promise } = tap(this.createRequest<R>(method, params, id), ({ payload }) => (
            this.client.send(this.dataEncoder(payload))
        ))

        return promise
    }

    public async batchCall(requests: Array<{ method: string, params?: any, id?: string | number }>) {
        const data = requests.map(({ method, params, id }) => this.createRequest(method, params, id))

        this.client.send(
            this.dataEncoder(data.map(({ payload }) => payload)),
        )

        return Promise.all(data.map(({ promise }) => promise))
    }

    protected createRequest<R = any>(method: string, params?: any, _id?: string | number) {
        const id = _id ?? ++this.incrementId
        const request = this.requests[id] = createDeferred()
        const payload = createRequestMessage(id, method, params)

        const _request = request.then((r) => {
            if (isJsonRpcErrorResponseMessage(r)) {
                throw new JsonRpcRequestError('Request failed', { url: this.url, payload, response: r, cause: toJsonRpcError(r.error) })
            }

            return r.result as R
        })

        return { payload, promise: withTimeout(_request, this.requestTimeout, new JsonRpcRequestError('Request timeout', { url: this.url, payload })) }
    }

    protected handleMessage(message: WebSocketMessage) {
        if (!isJsonRpcMessage(message)) {
            return this.emit('unknown-message', message)
        }

        if (isJsonRpcRequestMessage(message) && message.method === 'ping') {
            return this.client.send(this.dataEncoder(createResponseMessage(message.id, 'pong')))
        }

        if (isJsonRpcNotifyMessage(message)) {
            this.emit('notify', message.method, message.params)

            if (message.method === 'subscribe' && isKeysOf(message.params, ['event', 'result']) && isString(message.params.event)) {
                this.emit(message.params.event, message.params.result)
            }

            return
        }

        if (isJsonRpcResponseMessage(message)) {
            const request = this.requests[message.id]

            if (request) {
                return request.resolve(message)
            }

            if (message.id === 'ping') {
                return
            }
        }

        if (isKeysOf(message, ['error']) && isJsonRpcError(message.error)) {
            return this.emit('rpc-error', toJsonRpcError(message.error))
        }

        return this.emit('unknown-message', message)
    }

    protected onMessage(data: WebSocketMessage) {
        const message = tryCatch(() => this.dataDecoder(data), data)

        if (isArray(message)) {
            for (const item of message) {
                this.handleMessage(item)
            }

            return
        }

        this.handleMessage(message)
    }

    protected registerClientEvents(client: WebSocketClient) {
        client.on('message', (data) => this.onMessage(data))

        client.on('reconnected', () => {
            if (this.autoResubscribe) {
                for (const [event, params] of this.subscriptions) {
                    this.subscribe(event, params).catch((error: unknown) => {
                        this.emit('error', Object.assign(error instanceof WebsocketClientError ? error : new WebsocketClientError(client, 'Failed to resubscribe', { cause: error }), { event, params }))
                    })
                }
            }
        })

        for (const event of ['open', 'close', 'reconnect', 'reconnected', 'reconnect-failed', 'error']) {
            client.on(event, (...args: any) => this.emit(event, ...args))
        }

        return client
    }
}
