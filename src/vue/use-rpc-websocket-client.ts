import { isKeysOf } from '@kdt310722/utils/object'
import { isString } from '@kdt310722/utils/string'
import { tryOnScopeDispose, useEventListener } from '@vueuse/core'
import { type MaybeRefOrGetter, ref, toRef, watch } from 'vue'
import type { JsonRpcError } from '../errors'
import { RpcWebSocketClient, type RpcWebSocketClientOptions } from '../rpc'
import type { UrlLike, WebSocketMessage } from '../types'
import type { UseWebSocketClientOptions, WebSocketClientState } from './use-websocket-client'

export interface UseRpcWebsocketClientOptions extends RpcWebSocketClientOptions, Omit<UseWebSocketClientOptions, 'onMessage'> {
    immediate?: boolean
    onUnknownMessage?: (message: WebSocketMessage) => void
    onRpcError?: (error: JsonRpcError) => void
    onNotify?: (method: string, params?: any) => void
}

export interface UseRpcWebsocketClientSubscribeParams {
    event: string
    params?: any
    onData: (data: any) => void
}

export function useRpcWebsocketClient(url: MaybeRefOrGetter<UrlLike>, options: UseRpcWebsocketClientOptions = {}) {
    const { immediate = true, autoClose = true, onOpen, onClose, onReconnect, onReconnectFailed, onUnknownMessage, onRpcError, onNotify, ..._options } = options

    const _url = toRef(url)
    const client = ref<RpcWebSocketClient>()
    const error = ref<Error>()
    const state = ref<WebSocketClientState>('CLOSED')
    const listeners = ref(new Map<string, Set<(data: any) => void>>())

    const init = () => {
        error.value = undefined
        state.value = 'CONNECTING'
        listeners.value.clear()
        client.value = new RpcWebSocketClient(_url.value, { ..._options, autoConnect: false })

        client.value.on('error', (err) => (error.value = err))
        client.value.on('reconnect', (attempt) => onReconnect?.(attempt))
        client.value.on('reconnect-failed', () => onReconnectFailed?.())
        client.value.on('unknown-message', (message) => onUnknownMessage?.(message))
        client.value.on('rpc-error', (err) => onRpcError?.(err))

        client.value.on('close', (code, reason) => {
            state.value = 'CLOSED'
            onClose?.(code, reason)
        })

        client.value.on('open', () => {
            state.value = 'OPEN'
            onOpen?.()
        })

        client.value.on('notify', (method, params) => {
            onNotify?.(method, params)

            if (method === 'subscribe' && isKeysOf(params, ['event', 'result']) && isString(params.event)) {
                for (const listener of listeners.value.get(params.event) ?? []) {
                    listener(params.result)
                }
            }
        })

        client.value.connect().catch((error) => {
            error.value = error
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

    const ensureInit = () => {
        if (!client.value) {
            throw new Error('WebSocket is not initialized')
        }

        return client.value
    }

    const call = async (method: string, params?: any) => ensureInit().call(method, params)
    const notify = (method: string, params?: any) => ensureInit().notify(method, params)
    const batchCall = async (requests: Array<{ method: string, params?: any }>) => ensureInit().batchCall(requests)
    const unsubscribe = async (event: string) => ensureInit().unsubscribe(event)

    const subscribe = async (params: UseRpcWebsocketClientSubscribeParams) => {
        if (!listeners.value.has(params.event)) {
            listeners.value.set(params.event, new Set())
        }

        return Promise.resolve(listeners.value.get(params.event)?.add(params.onData)).then(async () => (
            ensureInit().subscribe(params.event, params.params)
        ))
    }

    watch(_url, () => open())

    if (autoClose) {
        useEventListener('beforeunload', () => close())
        tryOnScopeDispose(() => close())
    }

    if (immediate) {
        open()
    }

    return { client, error, state, open, close, call, notify, batchCall, subscribe, unsubscribe }
}
