import { wrap } from '@kdt310722/utils/array'
import { isBoolean, notNullish } from '@kdt310722/utils/common'
import { Emitter } from '@kdt310722/utils/event'
import { resolveNestedOptions } from '@kdt310722/utils/object'
import { createDeferred, sleep, withRetry, withTimeout } from '@kdt310722/utils/promise'
import { WebSocket } from 'ws'
import { WebsocketClientError } from '../errors'
import type { UrlLike, WebSocketMessage } from '../types'
import { Heartbeat } from '../utils'

export interface ReconnectOptions {
    enable?: boolean
    delay?: number
    attempts?: number
}

export interface HeartbeatOptions {
    enable?: boolean
    interval?: number
    timeout?: number
}

export interface WebSocketClientOptions {
    protocols?: string | string[]
    connectTimeout?: number
    disconnectTimeout?: number
    sendTimeout?: number
    reconnect?: ReconnectOptions | boolean
    heartbeat?: HeartbeatOptions | boolean
}

export type WebSocketClientEvents = {
    'connected': () => void
    'disconnected': (code: number, reason: Buffer, isExplicitlyClosed: boolean) => void
    'reconnect': (attempts: number) => void
    'error': (error: WebsocketClientError) => void
    'message': (message: WebSocketMessage) => void
}

export class WebSocketClient extends Emitter<WebSocketClientEvents> {
    public readonly url: string
    public readonly protocols: string[]

    protected readonly connectTimeout: number
    protected readonly disconnectTimeout: number
    protected readonly sendTimeout: number

    protected readonly reconnectOptions: Required<ReconnectOptions>
    protected readonly heartbeat?: Heartbeat

    protected socket?: WebSocket
    protected explicitlyClosed = false
    protected retryCount = 0

    public constructor(url: UrlLike, { protocols = [], connectTimeout = 10 * 1000, disconnectTimeout = 10 * 1000, sendTimeout = 10 * 1000, reconnect = true, heartbeat = true }: WebSocketClientOptions = {}) {
        super()

        this.url = new URL(url).href
        this.protocols = wrap(protocols)

        const { enable: enableReconnect = true, attempts: reconnectAttempts = 3, delay: reconnectDelay = 1000 } = resolveNestedOptions(reconnect) || {}
        const { enable: enableHeartbeat = true, interval: heartbeatInterval = 30 * 1000, timeout: heartbeatTimeout = 10 * 1000 } = resolveNestedOptions(heartbeat) || {}

        this.connectTimeout = connectTimeout
        this.disconnectTimeout = disconnectTimeout
        this.sendTimeout = sendTimeout
        this.reconnectOptions = { enable: enableReconnect, attempts: reconnectAttempts, delay: reconnectDelay }
        this.heartbeat = enableHeartbeat ? new Heartbeat(heartbeatTimeout, heartbeatInterval, () => this.isConnected && this.socket?.ping(), () => this.disconnect(false)) : undefined
    }

    public get isConnected() {
        return this.socket?.readyState === WebSocket.OPEN
    }

    public get isReconnectAttemptReached() {
        return this.retryCount >= this.reconnectOptions.attempts
    }

    public resetRetryCount() {
        this.retryCount = 0
    }

    public async connect() {
        this.explicitlyClosed = false

        if (this.socket) {
            return
        }

        await this.createConnection()
    }

    public async disconnect(code?: number | boolean, reason?: string, isExplicitlyClosed = true) {
        if (!this.socket) {
            return
        }

        if (isBoolean(code)) {
            isExplicitlyClosed = code
            code = undefined
        }

        if (isExplicitlyClosed) {
            this.explicitlyClosed = true
        }

        const socket = this.socket
        const disconnected = createDeferred<void>()

        socket.once('close', () => {
            disconnected.resolve()
        })

        socket.close(code, reason)

        await withTimeout(disconnected, this.disconnectTimeout).catch(() => {
            this.terminate()
        })
    }

    public terminate() {
        this.socket?.terminate()
    }

    public async send(message: WebSocketMessage) {
        if (!this.socket || !this.isConnected) {
            throw new WebsocketClientError(this, 'WebSocket is not connected')
        }

        const sent = createDeferred<void>()

        this.socket.send(message, (error) => {
            return notNullish(error) ? sent.reject(Object.assign(new WebsocketClientError(this, 'Failed to send message to WebSocket server', { cause: error }), { message })) : sent.resolve()
        })

        await withTimeout(sent, this.sendTimeout, () => (
            Object.assign(new WebsocketClientError(this, 'Send timeout'), { message })
        ))
    }

    protected async createConnection() {
        const socket = this.socket = new WebSocket(this.url, this.protocols)
        const connected = createDeferred<void>()

        socket.on('pong', () => {
            this.heartbeat?.resolve()
        })

        socket.on('ping', () => {
            this.heartbeat?.resolve()
            socket.pong()
        })

        socket.on('message', (message) => {
            this.heartbeat?.resolve()
            this.emit('message', message)
        })

        socket.on('open', () => {
            connected.resolve()

            this.heartbeat?.start()
            this.emit('connected')
        })

        socket.on('close', (code, reason) => {
            this.socket = undefined
            this.heartbeat?.stop()

            if (!connected.isSettled) {
                return connected.reject(new WebsocketClientError(this, 'Connection closed before it was established'))
            }

            this.handleClose(code, reason)
        })

        socket.on('error', (error) => {
            if (!connected.isSettled) {
                return connected.reject(new WebsocketClientError(this, 'Connect error', { cause: error }))
            }

            this.emit('error', new WebsocketClientError(this, 'Socket error', { cause: error }))
        })

        await withTimeout(connected, this.connectTimeout, () => new WebsocketClientError(this, 'Connect timeout')).catch((error) => {
            this.socket = undefined
            throw error
        })
    }

    protected handleClose(code: number, reason: Buffer) {
        this.emit('disconnected', code, reason, this.explicitlyClosed)

        if (!this.explicitlyClosed && this.reconnectOptions.enable && !this.isReconnectAttemptReached) {
            this.emit('reconnect', ++this.retryCount)

            const retry = async () => withRetry(() => this.connect(), {
                delay: this.reconnectOptions.delay,
                retries: this.reconnectOptions.attempts - this.retryCount,
                onFailedAttempt: () => {
                    this.retryCount++
                },
            })

            sleep(this.reconnectOptions.delay).then(() => retry()).catch((error) => {
                this.emit('error', new WebsocketClientError(this, 'Reconnect failed', { cause: error }))
            })
        }
    }
}
