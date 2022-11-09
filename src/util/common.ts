import BASE64 from 'base-64'

export const typeDecoder = {
    number: bytesToNumber,
    text: (bytes: Uint8Array) => new TextDecoder().decode(bytes)
}

export const typeEncoder = {
    number: numberToBytes,
    text: (string: string) => new TextEncoder().encode(string)
}

export const base64 = {
    fromBytes: (bytes: Uint8Array) => BASE64.encode(String.fromCharCode.apply(null, new Uint8Array(bytes) as any)),
    toBytes: (string: string) => Uint8Array.from(BASE64.decode(string), c => c.charCodeAt(0))
}

export const DEFAULT_LSN = numberToBytes(0);

export function numberToBytes(i: number) {
    return Uint8Array.of(
        (i & 0xff000000) >> 24,
        (i & 0x00ff0000) >> 16,
        (i & 0x0000ff00) >> 8,
        (i & 0x000000ff) >> 0);
}

export function bytesToNumber(bs: Uint8Array) {
    let n = 0;
    for (const byte of bs.values()) {
        n = (n << 8) | byte;
    }
    return n;
}
