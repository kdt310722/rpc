import { type Server as HttpServer, type IncomingMessage, type RequestListener, createServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { notNullish } from '@kdt310722/utils/common'
import { Emitter } from '@kdt310722/utils/event'
import { isNumber } from '@kdt310722/utils/number'
import { type AnyObject, pick, resolveNestedOptions } from '@kdt310722/utils/object'
import { createDeferred, withTimeout } from '@kdt310722/utils/promise'
import { WebSocketServer as BaseWebSocketServer, type WebSocket } from 'ws'
import type { WebSocketMessage } from '../types'
import { Heartbeat, getRequestClientIp } from '../utils'
import type { HeartbeatOptions } from './client'

export interface Client<TMetadata extends AnyObject = AnyObject> {
    id: number
    ip: string
    socket: WebSocket
    request: IncomingMessage
    metadata: TMetadata
    send: (message: WebSocketMessage) => Promise<void>
}

export interface BeforeUpgradeContext<TMetadata extends AnyObject = AnyObject> {
    request: IncomingMessage
    socket: Duplex
    head: Buffer
    metadata: TMetadata
}

export type BeforeUpgradeHandler<TMetadata extends AnyObject = AnyObject> = (context: BeforeUpgradeContext<TMetadata>, upgrade: () => void) => void

export interface WebSocketServerOptions {
    path?: string
    listener?: RequestListener
    heartbeat?: HeartbeatOptions | boolean
    sendTimeout?: number
    beforeUpgrade?: BeforeUpgradeHandler
}

export type WebSocketServerEvents<TMetadata extends AnyObject = AnyObject> = {
    error: (error: unknown) => void
    clientError: (error: unknown, client: Client<TMetadata>) => void
    listening: () => void
    close: () => void
    connection: (client: Client<TMetadata>) => void
}

export class WebSocketServer<TMetadata extends AnyObject = AnyObject> extends Emitter<WebSocketServerEvents<TMetadata>> {
    protected readonly http: HttpServer
    protected readonly ws: BaseWebSocketServer
    protected readonly heartbeatOptions: Required<HeartbeatOptions>
    protected readonly sendTimeout: number
    protected readonly beforeUpgrade?: BeforeUpgradeHandler<TMetadata>
    protected readonly clients: Record<number, Client<TMetadata>> = {}

    protected clientId = 0

    public constructor(public readonly host: string, public readonly port: number, options: WebSocketServerOptions = {}) {
        super()

        const { path = '/', listener, heartbeat = true, sendTimeout = 10 * 1000, beforeUpgrade } = options
        const { enable: enableHeartbeat = true, interval = 30 * 1000, timeout = 10 * 1000 } = resolveNestedOptions(heartbeat) || { enable: false }

        this.ws = this.createWebSocketServer(path)
        this.http = this.createHttpServer(listener)
        this.heartbeatOptions = { enable: enableHeartbeat, interval, timeout }
        this.sendTimeout = sendTimeout
        this.beforeUpgrade = beforeUpgrade
    }

    public async start() {
        const started = createDeferred<void>()

        this.http.once('error', (error) => started.reject(error))
        this.http.listen(this.port, this.host, () => started.resolve())

        return started
    }

    public async stop() {
        const stopped = createDeferred<void>()

        this.http.close((error) => {
            return notNullish(error) ? stopped.reject(error) : stopped.resolve()
        })

        return stopped
    }

    public async send(socket: WebSocket, message: WebSocketMessage, clientId?: number) {
        const sent = createDeferred<void>()

        socket.send(message, (error) => {
            return notNullish(error) ? sent.reject(this.createClientError('Failed to send message to WebSocket client', { cause: error }, clientId, { data: message })) : sent.resolve()
        })

        await withTimeout(sent, this.sendTimeout, () => this.createClientError('Send timeout', {}, clientId, { data: message }))
    }

    protected handleConnection(metadata: TMetadata, socket: WebSocket, request: IncomingMessage) {
        const id = ++this.clientId
        const ip = getRequestClientIp(request)
        const client = this.clients[id] = { id, ip, socket, request, metadata, send: (message: WebSocketMessage) => this.send(socket, message, id) }

        const heartbeat = new Heartbeat(this.heartbeatOptions.timeout, this.heartbeatOptions.interval, () => socket.ping(), () => {
            socket.close()
            this.emit('clientError', new Error('Heartbeat timeout'), client)
        })

        socket.on('error', (error) => this.emit('clientError', error, client))
        socket.on('close', () => heartbeat.stop())
        socket.on('pong', () => heartbeat.resolve())
        socket.on('message', () => heartbeat.resolve())

        socket.on('ping', () => {
            socket.pong()
            heartbeat.resolve()
        })

        if (this.heartbeatOptions.enable) {
            heartbeat.start()
        }

        this.emit('connection', client)
    }

    protected handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
        const metadata = {} as TMetadata

        const upgrade = () => {
            this.ws.handleUpgrade(request, socket, head, this.handleConnection.bind(this, metadata))
        }

        if (this.beforeUpgrade) {
            this.beforeUpgrade({ request, socket, head, metadata }, upgrade)
        } else {
            upgrade()
        }
    }

    protected createWebSocketServer(path: string) {
        const server = new BaseWebSocketServer({ noServer: true, path })

        server.on('error', (error) => {
            this.emit('error', error)
        })

        return server
    }

    protected createHttpServer(listener?: RequestListener) {
        const server = createServer(listener)

        server.on('error', this.emit.bind(this, 'error'))
        server.on('listening', this.emit.bind(this, 'listening'))
        server.on('close', this.emit.bind(this, 'close'))
        server.on('upgrade', this.handleUpgrade.bind(this))

        return server
    }

    protected createClientError(message: string, options?: ErrorOptions, client?: number | Client<TMetadata>, data: AnyObject = {}) {
        if (isNumber(client)) {
            client = this.clients[client]
        }

        return Object.assign(new Error(message, options), { ...(notNullish(client) ? { client: pick(client, 'id', 'ip', 'metadata') } : {}), ...data })
    }
}
