/**
 * Симуляция CORS-фильтра браузера для тестов.
 *
 * Плагин ходит на spearo.app кросс-доменно, поэтому JS видит ТОЛЬКО
 * CORS-safelisted заголовки + перечисленные в Access-Control-Expose-Headers.
 * Если сервер забудет `Access-Control-Expose-Headers: Retry-After`, браузер
 * спрячет Retry-After — тесты обязаны идти через этот фильтр, а не через сырой ответ.
 */
const SAFELISTED = new Set([
    'cache-control',
    'content-language',
    'content-length',
    'content-type',
    'expires',
    'last-modified',
    'pragma',
]);

export interface RawResponseInit {
    status: number;
    body: unknown;
    /** Все заголовки, которые реально шлёт сервер. */
    headers?: Record<string, string>;
}

/** Ответ, прошедший через CORS-фильтр: скрытые заголовки недоступны. */
export function corsResponse({ status, body, headers = {} }: RawResponseInit): unknown {
    const lower: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        lower[key.toLowerCase()] = value;
    }
    const exposed = new Set(
        (lower['access-control-expose-headers'] ?? '')
            .split(',')
            .map(h => h.trim().toLowerCase())
            .filter(Boolean),
    );
    return {
        status,
        ok: status >= 200 && status < 300,
        headers: {
            get(name: string): string | null {
                const key = name.toLowerCase();
                if (!SAFELISTED.has(key) && !exposed.has(key)) {
                    return null; // браузер прячет незаявленный заголовок
                }
                return lower[key] ?? null;
            },
        },
        json: async () => {
            if (body === undefined) throw new SyntaxError('Unexpected end of JSON input');
            if (typeof body === 'function') return (body as () => unknown)();
            return body;
        },
    };
}

/** Заголовки «как у правильного роута»: CORS + Retry-After наружу. */
export function corsHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Retry-After',
        Vary: 'Accept-Encoding',
        ...extra,
    };
}
