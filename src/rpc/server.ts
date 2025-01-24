import { Emitter } from '@kdt310722/utils/event'
import { stringifyJson } from '@kdt310722/utils/json'
import type { AnyObject } from '@kdt310722/utils/object'
import type { WebSocket } from 'ws'
import type { DataEncoder, JsonRpcMessage, WebSocketMessage } from '../types'
import { RPC_NOTIFY_MESSAGE, RpcMessageHandler, type RpcMessageHandlerOptions, type RpcMethodHandler, createNotifyMessage } from '../utils'
import { type Client, WebSocketServer, type WebSocketServerOptions } from '../websocket'

export type RpcClientEvents = {
    notification: (method: string, params?: any) => void
}

export interface RpcClient<TMetadata extends AnyObject = AnyObject> extends Omit<Client<TMetadata>, 'send'> {
    events: Emitter<RpcClientEvents>
    notify: (method: string, params?: any) => Promise<void>
    send: (data: JsonRpcMessage[] | JsonRpcMessage) => Promise<void>
    sendRaw: (data: WebSocketMessage) => Promise<void>
}

export interface RpcWebSocketServerOptions<TRpcClient extends RpcClient = RpcClient> extends WebSocketServerOptions, RpcMessageHandlerOptions {
    methods?: Record<string, RpcMethodHandler<TRpcClient>>
    dataEncoder?: DataEncoder
}

export type RpcWebSocketServerEvents<TRpcClient extends RpcClient = RpcClient> = {
    error: (error: unknown) => void
    connection: (client: TRpcClient) => void
    notification: (client: TRpcClient, method: string, params?: any) => void
    unhandledMessage: (client: TRpcClient, message: WebSocketMessage) => void
}

export class RpcWebSocketServer<TRpcClient extends RpcClient = RpcClient> extends Emitter<RpcWebSocketServerEvents<TRpcClient>> {
    public readonly server: WebSocketServer<TRpcClient['metadata']>
    public readonly messageHandler: RpcMessageHandler

    protected readonly dataEncoder: DataEncoder

    public constructor(host: string, port: number, { methods = {}, dataEncoder = stringifyJson, ...options }: RpcWebSocketServerOptions = {}) {
        super()

        this.dataEncoder = dataEncoder
        this.server = this.createServer(host, port, options)
        this.messageHandler = new RpcMessageHandler<TRpcClient>(methods as any, options)

        this.messageHandler.on('notification', (method, params, context) => this.emit('notification', context, method, params))
        this.messageHandler.on('unhandledMessage', (message, context) => this.emit('unhandledMessage', context, message))
        this.messageHandler.on('error', (error) => this.emit('error', error))
    }

    public addMethod(name: string, handler: RpcMethodHandler<TRpcClient>, override = false) {
        return this.messageHandler.addMethod(name, handler, override)
    }

    public async notify(socket: WebSocket, method: string, params?: any, clientId?: number) {
        return this.server.send(socket, this.dataEncoder(createNotifyMessage(method, params)), clientId)
    }

    public async send(socket: WebSocket, data: JsonRpcMessage[] | JsonRpcMessage, clientId?: number) {
        return this.server.send(socket, this.dataEncoder(data), clientId)
    }

    protected handleConnection(client: Client<TRpcClient['metadata']>) {
        const notify = (method: string, params?: any) => this.notify(client.socket, method, params, client.id)
        const sendRaw = (data: WebSocketMessage) => client.send(data)
        const send = (data: JsonRpcMessage[] | JsonRpcMessage) => this.send(client.socket, data, client.id)

        const events = new Emitter<RpcClientEvents>()
        const rpcClient = { ...client, events, notify, send, sendRaw } as TRpcClient

        events.on('notification', (method, params) => {
            this.emit('notification', rpcClient, method, params)
        })

        client.socket.on('message', (message) => {
            this.messageHandler.handleMessage(message, rpcClient).then(async (r) => {
                if (r !== RPC_NOTIFY_MESSAGE) {
                    await send(r)
                }
            })
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
