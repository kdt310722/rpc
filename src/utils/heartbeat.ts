import type { Fn } from '@kdt310722/utils/function'

export class Heartbeat {
    protected pingInterval?: ReturnType<typeof setInterval>
    protected pongTimeout?: ReturnType<typeof setTimeout>

    public constructor(protected readonly timeout: number, protected readonly interval: number, protected readonly fn: Fn, protected readonly onTimeout: Fn) {}

    public start() {
        this.pingInterval = setInterval(() => this.run(), this.interval)
    }

    public stop() {
        clearInterval(this.pingInterval)
        clearTimeout(this.pongTimeout)
    }

    public resolve() {
        clearTimeout(this.pongTimeout)
    }

    protected run() {
        this.pongTimeout = setTimeout(() => this.onTimeout(), this.timeout)
        this.fn()
    }
}
