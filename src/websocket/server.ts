import { type Server as HttpServer, type IncomingMessage, type RequestListener, createServer } from 'node:http'
import type { Duplex } from 'node:stream'
import { notNullish } from '@kdt310722/utils/common'
import { Emitter } from '@kdt310722/utils/event'
import { resolveNestedOptions } from '@kdt310722/utils/object'
import { createDeferred, withTimeout } from '@kdt310722/utils/promise'
import { WebSocketServer as BaseWebSocketServer, type WebSocket } from 'ws'
import type { WebSocketMessage } from '../types'
import { Heartbeat } from '../utils'
import type { HeartbeatOptions } from './client'

export interface Client {
    id: number
    socket: WebSocket
    request: IncomingMessage
    send: (message: WebSocketMessage) => Promise<void>
}

export interface WebSocketServerOptions {
    path?: string
    listener?: RequestListener
    heartbeat?: HeartbeatOptions | boolean
    sendTimeout?: number
}

export type WebSocketServerEvents = {
    error: (error: unknown) => void
    listening: () => void
    close: () => void
    connection: (client: Client) => void
}

export class WebSocketServer extends Emitter<WebSocketServerEvents> {
    protected readonly http: HttpServer
    protected readonly ws: BaseWebSocketServer
    protected readonly heartbeatOptions: Required<HeartbeatOptions>
    protected readonly sendTimeout: number

    protected clientId = 0

    public constructor(public readonly host: string, public readonly port: number, options: WebSocketServerOptions = {}) {
        super()

        const { path = '/', listener, heartbeat = true, sendTimeout = 10 * 1000 } = options
        const { enable: enableHeartbeat = true, interval = 30 * 1000, timeout = 10 * 1000 } = resolveNestedOptions(heartbeat) || {}

        this.ws = this.createWebSocketServer(path)
        this.http = this.createHttpServer(listener)
        this.heartbeatOptions = { enable: enableHeartbeat, interval, timeout }
        this.sendTimeout = sendTimeout
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
            return notNullish(error) ? sent.reject(Object.assign(new Error('Failed to send message to WebSocket client', { cause: error }), { clientId, message })) : sent.resolve()
        })

        await withTimeout(sent, this.sendTimeout, () => (
            Object.assign(new Error('Send timeout'), { clientId, message })
        ))
    }

    protected handleConnection(socket: WebSocket, request: IncomingMessage) {
        const id = ++this.clientId
        const client = { id, socket, request, send: (message: WebSocketMessage) => this.send(socket, message) }

        const heartbeat = new Heartbeat(this.heartbeatOptions.timeout, this.heartbeatOptions.interval, () => socket.ping(), () => {
            socket.close()
        })

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
        this.ws.handleUpgrade(request, socket, head, this.handleConnection.bind(this))
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
}
