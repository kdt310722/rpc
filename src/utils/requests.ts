import type { IncomingMessage } from 'node:http'
import { isString } from '@kdt310722/utils/string'

export function getRequestClientIp(request: IncomingMessage) {
    const header = request.headers['x-forwarded-for']

    if (header) {
        return isString(header) ? header.split(',')[0].trim() : header[0]
    }

    return request.socket.remoteAddress ?? 'UNKNOWN'
}
