import { tap } from '@kdt310722/utils/function'
import { tryOnScopeDispose, useEventListener } from '@vueuse/core'
import { type MaybeRefOrGetter, ref, toRef, watch } from 'vue'
import type { UrlLike, WebSocketMessage } from '../types'
import { WebSocketClient, type WebSocketClientOptions } from '../websocket'

export type WebSocketClientState = 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED'

export interface UseWebSocketClientOptions extends Omit<WebSocketClientOptions, 'autoConnect'> {
    immediate?: boolean
    autoClose?: boolean
    watchUrl?: boolean
    onOpen?: () => void
    onClose?: (code: number, reason: string) => void
    onReconnect?: (attempt: number) => void
    onReconnectFailed?: () => void
    onMessage?: (data: WebSocketMessage) => void
}

export function useWebSocketClient(url: MaybeRefOrGetter<UrlLike>, options: UseWebSocketClientOptions = {}) {
    const { immediate = true, autoClose = true, watchUrl = true, onOpen, onClose, onReconnect, onReconnectFailed, onMessage, ..._options } = options

    const _url = toRef(url)
    const error = ref<Error>()
    const data = ref<WebSocketMessage>()
    const client = ref<WebSocketClient>()
    const state = ref<WebSocketClientState>('CLOSED')

    const init = () => {
        error.value = undefined
        data.value = undefined
        state.value = 'CONNECTING'
        client.value = new WebSocketClient(_url.value, { ..._options, autoConnect: false })

        client.value.on('error', (err) => (error.value = err))
        client.value.on('reconnect', (attempt) => onReconnect?.(attempt))
        client.value.on('reconnect-failed', () => onReconnectFailed?.())

        client.value.on('close', (code, reason) => {
            state.value = 'CLOSED'
            onClose?.(code, reason)
        })

        client.value.on('open', () => {
            state.value = 'OPEN'
            onOpen?.()
        })

        client.value.on('message', (msg) => {
            data.value = msg
            onMessage?.(msg)
        })

        client.value.connect().catch((_error: unknown) => {
            error.value = _error instanceof Error ? _error : new Error('An error occurred', { cause: _error })
        })
    }

    const close = (code?: number, reason?: string) => {
        state.value = 'CLOSING'
        client.value?.disconnect(code, reason)
    }

    const open = () => {
        close()
        init()
    }

    const send = (data: WebSocketMessage) => {
        if (!client.value) {
            return tap(void 0, () => error.value = new Error('WebSocket is not initialized'))
        }

        client.value.send(data)
    }

    if (watchUrl) {
        watch(_url, () => open())
    }

    if (autoClose) {
        useEventListener('beforeunload', () => close())
        tryOnScopeDispose(() => close())
    }

    if (immediate) {
        open()
    }

    return { data, error, client, state, close, open, send }
}
