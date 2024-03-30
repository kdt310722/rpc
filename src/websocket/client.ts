import { wrap } from '@kdt310722/utils/array'
import { Emitter } from '@kdt310722/utils/event'
import { tap } from '@kdt310722/utils/function'
import { resolveNestedOptions } from '@kdt310722/utils/object'
import { createDeferred, sleep, withTimeout } from '@kdt310722/utils/promise'
import { WebSocket } from 'isows'
import { WebsocketClientError } from '../errors'
import type { UrlLike, WebSocketMessage } from '../types'

export interface AutoReconnectOptions {
    delay?: number
    attempts?: number
}

export interface HeartbeatOptions {
    interval?: number
    timeout?: number
}

export interface WebSocketClientOptions {
    protocols?: string | string[]
    connectTimeout?: number
    autoConnect?: boolean
    autoReconnect?: AutoReconnectOptions | boolean
    heartbeat?: HeartbeatOptions | boolean
    heartbeatMessage?: WebSocketMessage
}

export type WebSocketClientEvents = {
    'error': (error: WebsocketClientError) => void
    'close': (code: number, reason: string) => void
    'open': () => void
    'message': (data: WebSocketMessage) => void
    'reconnect': (attempt: number) => void
    'reconnect-failed': () => void
}

export class WebSocketClient extends Emitter<WebSocketClientEvents> {
    public readonly url: string
    public readonly protocols: string[]

    protected readonly connectTimeout: number
    protected readonly autoReconnect: Required<AutoReconnectOptions>
    protected readonly heartbeat: Required<HeartbeatOptions> & { enabled: boolean }
    protected readonly heartbeatMessage: WebSocketMessage

    protected websocket?: Promise<WebSocket>
    protected explicitlyClosed = false
    protected retried = 0
    protected pingInterval?: ReturnType<typeof setInterval>
    protected pongTimeout?: ReturnType<typeof setTimeout>

    public constructor(url: UrlLike, options: WebSocketClientOptions = {}) {
        super()

        const { protocols = [], connectTimeout = 5000, autoConnect = true, autoReconnect = true, heartbeatMessage = 'ping' } = options
        const { delay = 0, attempts = 3 } = resolveNestedOptions(autoReconnect) || { delay: 0, attempts: 0 }
        const heartbeat = resolveNestedOptions(options.heartbeat ?? true)

        this.url = url instanceof URL ? url.href : url.toString()
        this.protocols = wrap(protocols)
        this.connectTimeout = connectTimeout
        this.autoReconnect = { delay, attempts }
        this.heartbeat = heartbeat ? { enabled: true, interval: 30_000, timeout: 10_000, ...heartbeat } : { enabled: false, interval: 0, timeout: 0 }
        this.heartbeatMessage = heartbeatMessage

        if (autoConnect) {
            this.connect().catch((error) => {
                this.onError(error)
            })
        }
    }

    public async connect() {
        if (this.websocket) {
            return this.websocket.then(() => void 0)
        }

        this.explicitlyClosed = false
        this.retried = 0
        this.websocket = this.createConnection()
    }

    public disconnect(code?: number, reason?: string) {
        this.explicitlyClosed = true
        this.resetHeartbeat()

        this.websocket?.then((ws) => {
            ws.close(code, reason)
        })
    }

    public send(data: WebSocketMessage) {
        this.connect().then(() => this.websocket).then((ws) => ws?.send(data)).catch((error) => {
            this.onError(error)
        })
    }

    protected resetHeartbeat() {
        clearInterval(this.pingInterval)
        clearTimeout(this.pongTimeout)
    }

    protected onMessage({ data }: MessageEvent) {
        clearTimeout(this.pongTimeout)
        this.emit('message', data)
    }

    protected onOpen() {
        this.emit('open')

        if (this.heartbeat.enabled) {
            this.pingInterval = setInterval(() => this.runHeartbeat(), this.heartbeat.interval)
        }
    }

    protected runHeartbeat() {
        this.pongTimeout = setTimeout(() => tap(this.explicitlyClosed = false, () => this.disconnect()), this.heartbeat.timeout)
        this.send(this.heartbeatMessage)
    }

    protected onClose({ code, reason }: CloseEvent) {
        this.emit('close', code, reason)

        if (!this.explicitlyClosed) {
            this.retried++

            if (this.retried < this.autoReconnect.attempts) {
                this.emit('reconnect', this.retried)

                sleep(this.autoReconnect.delay).then(() => this.createConnection()).catch((error) => {
                    this.onError(error)
                })
            } else if (this.autoReconnect.attempts > 0) {
                this.emit('reconnect-failed')
            }
        }
    }

    protected onError(error: WebsocketClientError) {
        if (this.listenerCount('error') === 0) {
            throw error
        }

        this.emit('error', error)
    }

    protected async createConnection() {
        const isConnected = createDeferred<void>()
        const client = new WebSocket(this.url, this.protocols)

        client.addEventListener('message', this.onMessage.bind(this))

        client.addEventListener('error', (event) => {
            const error = Object.assign(new WebsocketClientError(this), { event })

            if (!isConnected.isSettled) {
                return isConnected.reject(error)
            }

            this.onError(error)
        })

        client.addEventListener('close', (event) => {
            if (!isConnected.isSettled) {
                return isConnected.reject(new WebsocketClientError(this, 'Connection closed before it was established'))
            }

            this.onClose(event)
        })

        client.addEventListener('open', () => {
            isConnected.resolve()
            this.onOpen()
        })

        await withTimeout(isConnected, this.connectTimeout, new WebsocketClientError(this, 'Connect timeout')).catch((error) => {
            client.close()
            this.onError(error)
        })

        return client
    }
}
