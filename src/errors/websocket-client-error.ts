import type { WebSocketClient } from '../websocket'

export class WebsocketClientError extends Error {
    public declare readonly url?: string

    public constructor(client?: WebSocketClient, message?: string, options?: ErrorOptions) {
        super(message ?? 'An error occurred', options)

        if (client) {
            this.url = client.url
        }
    }
}
