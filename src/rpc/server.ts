import { isArray } from '@kdt310722/utils/array'
import { join } from '@kdt310722/utils/buffer'
import { isNull, notUndefined } from '@kdt310722/utils/common'
import { Emitter } from '@kdt310722/utils/event'
import { tap, tryCatch } from '@kdt310722/utils/function'
import { parseJson, stringifyJson } from '@kdt310722/utils/json'
import type { AnyObject } from '@kdt310722/utils/object'
import { type Awaitable, withTimeout } from '@kdt310722/utils/promise'
import type { RawData, WebSocket } from 'ws'
import { JsonRpcError } from '../errors'
import type { JsonRpcMessage, WebSocketMessage } from '../types'
import { createErrorResponseMessage, createNotifyMessage, createSuccessResponseMessage, isJsonRpcMessage, isJsonRpcNotifyMessage, isJsonRpcRequestMessage } from '../utils'
import { type Client, WebSocketServer, type WebSocketServerOptions } from '../websocket'

export type RpcClientEvents = {
    notification: (method: string, params?: any) => void
}

export interface RpcClient extends Omit<Client, 'send'> {
    events: Emitter<RpcClientEvents>
    notify: (method: string, params?: any) => Promise<void>
    send: (data: any[] | AnyObject) => Promise<void>
    sendRaw: (data: WebSocketMessage) => Promise<void>
}

export type RpcWebSocketMethodHandler = (params: any, client: RpcClient) => Awaitable<any>

export interface RpcWebSocketServerOptions extends WebSocketServerOptions {
    maxBatchSize?: number
    operationTimeout?: number
    methods?: Record<string, RpcWebSocketMethodHandler>
}

export type RpcWebSocketServerEvents = {
    error: (error: unknown) => void
    connection: (client: RpcClient) => void
    notification: (client: RpcClient, method: string, params?: any) => void
    unhandledMessage: (client: RpcClient, message: WebSocketMessage) => void
}

export class RpcWebSocketServer extends Emitter<RpcWebSocketServerEvents> {
    public readonly server: WebSocketServer

    protected readonly maxBatchSize: number
    protected readonly operationTimeout: number
    protected readonly methods: Record<string, RpcWebSocketMethodHandler>

    public constructor(host: string, port: number, { maxBatchSize = 100, operationTimeout = 60 * 1000, methods = {}, ...options }: RpcWebSocketServerOptions = {}) {
        super()

        this.server = this.createServer(host, port, options)
        this.maxBatchSize = maxBatchSize
        this.operationTimeout = operationTimeout
        this.methods = methods
    }

    public addMethod(name: string, handler: RpcWebSocketMethodHandler, override = false) {
        if (this.methods[name] && !override) {
            throw new Error(`Method ${name} already exists`)
        }

        this.methods[name] = handler
    }

    public async notify(socket: WebSocket, method: string, params?: any, clientId?: number) {
        return this.server.send(socket, stringifyJson(createNotifyMessage(method, params)), clientId)
    }

    public async send(socket: WebSocket, data: any[] | AnyObject, clientId?: number) {
        return this.server.send(socket, stringifyJson(data), clientId)
    }

    protected async getRpcResponse(client: RpcClient, message: JsonRpcMessage) {
        if (isJsonRpcNotifyMessage(message)) {
            return tap(void 0, () => client.events.emit('notification', message.method, message.params))
        }

        if (!isJsonRpcRequestMessage(message)) {
            return createErrorResponseMessage(message.id ?? null, new JsonRpcError(-32_600, 'Invalid Request'))
        }

        const handler = this.methods[message.method]

        if (!handler) {
            return createErrorResponseMessage(message.id, new JsonRpcError(-32_601, 'Method not found'))
        }

        const response = withTimeout(Promise.resolve().then(() => handler(message.params, client)), this.operationTimeout, () => {
            return new JsonRpcError(-32_000, 'Operation Timeout')
        })

        return response.then((r) => createSuccessResponseMessage(message.id, r)).catch((error) => {
            return createErrorResponseMessage(message.id, error instanceof JsonRpcError ? error : new JsonRpcError(-32_603, 'Internal Error'))
        })
    }

    protected handleRpcMessage(client: RpcClient, message: JsonRpcMessage) {
        this.getRpcResponse(client, message).then((response) => {
            if (notUndefined(response)) {
                client.send(response).catch((error) => this.emit('error', error))
            }
        })
    }

    protected handleRpcBatchMessage(client: RpcClient, messages: any[]) {
        if (messages.length > this.maxBatchSize) {
            return client.send(createErrorResponseMessage(null, new JsonRpcError(-32_600, 'Batch size exceeded')))
        }

        const responses = messages.map((message) => {
            if (!isJsonRpcMessage(message)) {
                return createErrorResponseMessage(null, new JsonRpcError(-32_600, 'Invalid Request'))
            }

            return this.getRpcResponse(client, message)
        })

        const result = Promise.all(responses).catch((error) => {
            return tap(createErrorResponseMessage(null, new JsonRpcError(-32_603, 'Internal Error')), () => this.emit('error', error))
        })

        result.then((r) => {
            client.send(isArray(r) ? r.filter(notUndefined) : r).catch((error) => this.emit('error', error))
        })

        return true
    }

    protected handleWebSocketMessage(client: RpcClient, message: RawData) {
        const data = tryCatch(() => parseJson(join(message)), null)

        if (isJsonRpcMessage(data)) {
            return this.handleRpcMessage(client, data)
        }

        if (isArray(data)) {
            return this.handleRpcBatchMessage(client, data)
        }

        const response = createErrorResponseMessage(null, isNull(data) ? new JsonRpcError(-32_700, 'Invalid JSON') : new JsonRpcError(-32_600, 'Invalid Request'))

        client.send(response).catch((error) => {
            this.emit('error', error)
        })

        return this.emit('unhandledMessage', client, data)
    }

    protected handleConnection(client: Client) {
        const notify = (method: string, params?: any) => this.notify(client.socket, method, params, client.id)
        const sendRaw = (data: WebSocketMessage) => client.send(data)
        const send = (data: any[] | AnyObject) => this.send(client.socket, data, client.id)

        const events = new Emitter<RpcClientEvents>()
        const rpcClient: RpcClient = { ...client, events, notify, send, sendRaw }

        events.on('notification', (method, params) => {
            this.emit('notification', rpcClient, method, params)
        })

        client.socket.on('message', (message) => {
            this.handleWebSocketMessage(rpcClient, message)
        })

        this.emit('connection', rpcClient)
    }

    protected createServer(host: string, port: number, options?: WebSocketServerOptions) {
        const server = new WebSocketServer(host, port, options)

        server.on('connection', (client) => {
            this.handleConnection(client)
        })

        return server
    }
}
