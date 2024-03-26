export class JsonRpcError extends Error {
    public constructor(public readonly code: number, message: string, public readonly data?: any, options?: ErrorOptions) {
        super(message, options)
    }
}
