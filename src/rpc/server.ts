import { isArray } from '@kdt310722/utils/array'
import { join } from '@kdt310722/utils/buffer'
import { isFunction, tap } from '@kdt310722/utils/function'
import { type AnyObject, isObject, resolveNestedOptions } from '@kdt310722/utils/object'
import type { Awaitable } from '@kdt310722/utils/promise'
import { isString } from '@kdt310722/utils/string'
import { WebSocket } from 'isows'
import { JsonRpcError } from '../errors'
import type { DataDecoder, DataEncoder, WebSocketMessage } from '../types'
import { createErrorResponse, createEventMessage, createResponseMessage, isJsonRpcMessage, isJsonRpcRequestMessage } from '../utils'

export interface WebsocketClientContext {
    id: number
    socket: WebSocket
    isAlive: boolean
    heartbeatTimer?: ReturnType<typeof setInterval>
    pongTimeout?: ReturnType<typeof setTimeout>
}

export interface RpcServerHeartbeatOptions {
    interval?: number
    timeout?: number
}

export interface RpcServerOptions {
    heartbeat?: RpcServerHeartbeatOptions | boolean
    heartbeatMessage?: WebSocketMessage
    exceptionHandler?: (error: Error) => JsonRpcError
    dataEncoder?: DataEncoder
    dataDecoder?: DataDecoder
    batchSize?: number
    onClientError?: (error: Error) => void
    onUnhandledError?: (error: Error) => void
}

const UNIQUE_ID = Symbol('UNIQUE_ID')

export class RpcWebSocketServer {
    protected readonly heartbeat: Required<RpcServerHeartbeatOptions> & { enabled: boolean }
    protected readonly heartbeatMessage: WebSocketMessage
    protected readonly exceptionHandler?: (error: Error) => JsonRpcError
    protected readonly onUnhandledError?: (error: Error) => void
    protected readonly clients = new Map<number, WebsocketClientContext>()
    protected readonly batchSize: number

    protected readonly dataEncoder: DataEncoder
    protected readonly dataDecoder: DataDecoder

    protected readonly methods = new Map<string, (params: any[], context: WebsocketClientContext) => Promise<any>>()
    protected readonly rpcEvents = new Map<string, Set<number>>()
    protected readonly rpcDynamicEvents: Array<(name: string) => boolean> = []

    protected incrementId = 0

    public constructor(protected readonly options: RpcServerOptions = {}) {
        const { exceptionHandler, onUnhandledError, dataEncoder, dataDecoder, batchSize = 100 } = options
        const heartbeat = resolveNestedOptions(options.heartbeat ?? true)

        this.heartbeat = heartbeat ? { enabled: true, interval: 30_000, timeout: 10_000, ...heartbeat } : { enabled: false, interval: 0, timeout: 0 }
        this.heartbeatMessage = options.heartbeatMessage ?? 'ping'
        this.exceptionHandler = exceptionHandler
        this.onUnhandledError = onUnhandledError
        this.dataEncoder = dataEncoder ?? JSON.stringify
        this.dataDecoder = dataDecoder ?? ((data) => JSON.parse(join(data)))
        this.batchSize = batchSize

        this.registerBuiltInMethods()
    }

    public addMethod(name: string, handler: (params: any[], context: WebsocketClientContext, server: RpcWebSocketServer) => Awaitable<any>) {
        this.methods.set(name, (params, context) => handler(params, context, this))
    }

    public addEvent(name: string | ((name: string) => boolean)) {
        if (isFunction(name)) {
            this.rpcDynamicEvents.push(name)

            return
        }

        if (!this.rpcEvents.has(name)) {
            this.rpcEvents.set(name, new Set())
        }
    }

    public emit(name: string, data: any) {
        const message = this.dataEncoder(createEventMessage(name, data))

        for (const id of this.rpcEvents.get(name) ?? []) {
            this.clients.get(id)?.socket.send(message)
        }
    }

    public send(socket: WebSocket, data: any) {
        socket.send(this.dataEncoder(data))
    }

    public handleConnection(socket: WebSocket) {
        const id = socket[UNIQUE_ID] = ++this.incrementId
        let heartbeatTimer: ReturnType<typeof setInterval> | undefined

        if (this.heartbeat.enabled) {
            heartbeatTimer = setInterval(() => this.runHeartbeat(socket, id), this.heartbeat.interval)
        }

        this.clients.set(id, { id, socket, isAlive: true, heartbeatTimer })

        const context = this.clients.get(id)!

        socket.addEventListener('error', (event) => {
            this.options.onClientError?.(Object.assign(new Error('Websocket error'), { event }))
        })

        socket.addEventListener('close', () => {
            const context = this.clients.get(id)

            if (context) {
                clearInterval(context.heartbeatTimer)
                clearTimeout(context.pongTimeout)
            }

            for (const [, clients] of this.rpcEvents) {
                clients.delete(id)
            }

            this.clients.delete(id)
        })

        socket.addEventListener('message', ({ data }) => {
            this.stillAlive(id)

            if (socket.readyState !== WebSocket.OPEN) {
                return
            }

            if (isString(data) && data === 'ping') {
                return socket.send('pong')
            }

            let rpcMessage: any

            try {
                rpcMessage = this.dataDecoder(data)
            } catch {
                return this.send(socket, createErrorResponse(null, new JsonRpcError(-32_700, 'Invalid JSON')))
            }

            if (!isArray(rpcMessage) && !isObject(rpcMessage)) {
                return this.send(socket, createErrorResponse(null, new JsonRpcError(-32_600, 'Invalid request')))
            }

            this.onMessage(context, rpcMessage).catch((error) => {
                throw new Error('Error while processing message', { cause: error })
            })
        })
    }

    protected runHeartbeat(socket: WebSocket, id: number) {
        const context = this.clients.get(id)!

        context.pongTimeout = setTimeout(() => !context.isAlive && socket.close(), this.heartbeat.timeout)
        context.isAlive = false

        socket.send(this.heartbeatMessage)
    }

    protected stillAlive(id: number) {
        const context = this.clients.get(id)

        if (context) {
            context.isAlive = true
            clearTimeout(context.pongTimeout)
        }
    }

    protected registerBuiltInMethods() {
        this.addMethod('ping', () => 'pong')

        this.addMethod('subscribe', (params, { id }) => {
            if (params.length !== 1 || !isString(params[0])) {
                throw new JsonRpcError(-32_602, 'Invalid params')
            }

            if (!this.rpcEvents.has(params[0])) {
                if (this.rpcDynamicEvents.some((handler) => handler(params[0]))) {
                    this.rpcEvents.set(params[0], new Set())
                } else {
                    throw new JsonRpcError(-32_602, 'Event not found')
                }
            }

            this.rpcEvents.get(params[0])?.add(id)

            return true
        })

        this.addMethod('unsubscribe', (params, { id }) => {
            if (params.length !== 1 || !isString(params[0])) {
                throw new JsonRpcError(-32_602, 'Invalid params')
            }

            this.rpcEvents.get(params[0])?.delete(id)

            return true
        })
    }

    protected async handleRpcMessage(context: WebsocketClientContext, message: AnyObject) {
        if (!isJsonRpcMessage(message)) {
            return createErrorResponse(null, new JsonRpcError(-32_600, 'Invalid request'))
        }

        if (!isJsonRpcRequestMessage(message)) {
            return
        }

        const method = this.methods.get(message.method)

        if (method) {
            try {
                return createResponseMessage(message.id, await method(message.params ?? [], context))
            } catch (error) {
                const err = error instanceof Error ? error : new Error('Unexpected error', { cause: error })

                if (err instanceof JsonRpcError) {
                    return createResponseMessage(message.id, undefined, err)
                }

                if (this.exceptionHandler) {
                    return createResponseMessage(message.id, undefined, this.exceptionHandler(err))
                }

                return tap(createResponseMessage(message.id, undefined, new JsonRpcError(-32_600, 'Internal error')), () => {
                    this.onUnhandledError?.(err)
                })
            }
        }

        return createErrorResponse(message.id, new JsonRpcError(-32_601, 'Method not found'))
    }

    protected async onMessage(context: WebsocketClientContext, data: AnyObject | any[]) {
        if (isArray(data)) {
            if (data.length > this.batchSize) {
                return this.send(context.socket, createErrorResponse(null, new JsonRpcError(-32_603, 'Batch size exceeded')))
            }

            return this.send(context.socket, await Promise.all(data.map((item) => this.handleRpcMessage(context, item).then((i) => i ?? null))))
        }

        return this.send(context.socket, await this.handleRpcMessage(context, data))
    }
}
