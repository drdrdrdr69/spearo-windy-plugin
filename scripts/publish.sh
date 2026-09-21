#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# Локальная публикация плагина в Windy — то же, что делает
# .github/workflows/publish-plugin.yml, но без GitHub Actions.
#
# Приватных action'ов в workflow нет: он просто собирает dist/, дописывает в
# dist/plugin.json поля repositoryName / repositoryOwner / commitSha, пакует
# каталог в tar и шлёт POST на https://node.windy.com/plugins/v1.0/upload
# с заголовком `x-windy-api-key`. Скрипт повторяет ровно эти шаги.
#
# Ключ читается ТОЛЬКО из ~/.config/spearo/windy_api_key (путь И endpoint зашиты,
# переопределить их переменными окружения нельзя), никогда из аргументов и никогда
# не печатается. Трассировка (`set -x` / `bash -x`) принудительно выключается перед
# чтением ключа и не включается обратно; заголовок уходит в curl через временный
# --config-файл (0600), чтобы ключ не светился в `ps`.
#
#   ./scripts/publish.sh            # собрать и опубликовать
#   ./scripts/publish.sh --dry-run  # всё, кроме самой отправки
#
# Переменных окружения, влияющих на ключ или endpoint, НЕТ — это осознанно.
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Секрет не должен попасть ни в один лог, даже если скрипт запустили как `bash -x`
# или с BASH_XTRACEFD в файл: выключаем трассировку до первого чтения ключа
# и больше не включаем.
set +x
PS4='+ '


DRY_RUN=0
for arg in "$@"; do
    case "$arg" in
        --dry-run) DRY_RUN=1 ;;
        -h | --help)
            sed -n '2,25p' "$0"
            exit 0
            ;;
        *)
            echo "Неизвестный аргумент: $arg" >&2
            exit 2
            ;;
    esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Пути и endpoint зашиты намеренно: подменяемый источник ключа или адрес заливки —
# это отправка секрета «куда-то ещё».
KEY_FILE="$HOME/.config/spearo/windy_api_key"
UPLOAD_URL="https://node.windy.com/plugins/v1.0/upload"

for tool in jq curl tar npm git; do
    command -v "$tool" >/dev/null 2>&1 || {
        echo "Нужен $tool, но он не найден в PATH." >&2
        exit 1
    }
done

# ── 1. Ключ ───────────────────────────────────────────────────────────────────
if [ ! -f "$KEY_FILE" ]; then
    cat >&2 <<MSG
Не найден файл с ключом Windy Plugins API: $KEY_FILE
Создайте его (ключ берётся на https://api.windy.com/keys):
    mkdir -p "$(dirname "$KEY_FILE")"
    printf '%s' '<ключ>' > "$KEY_FILE"
    chmod 600 "$KEY_FILE"
MSG
    exit 1
fi

PERMS="$(stat -f '%Lp' "$KEY_FILE" 2>/dev/null || stat -c '%a' "$KEY_FILE" 2>/dev/null || echo '')"
if [ -n "$PERMS" ] && [ "$PERMS" != "600" ]; then
    echo "ВНИМАНИЕ: права на $KEY_FILE = $PERMS, ожидается 600 (chmod 600 \"$KEY_FILE\")." >&2
fi

# Чтение ключа — в подоболочке с гарантированно выключенной трассировкой;
# tr -d вычищает перевод строки; значение никуда не печатается.
API_KEY="$(set +x; tr -d '\r\n' <"$KEY_FILE")"
if [ -z "$API_KEY" ]; then
    echo "Файл $KEY_FILE пустой — ключа нет." >&2
    exit 1
fi

# ── 2. Метаданные репозитория (как их кладёт workflow) ────────────────────────
cd "$ROOT"
COMMIT_SHA="$(git rev-parse HEAD 2>/dev/null || echo 'local')"
REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
if [ -n "$REMOTE_URL" ]; then
    REPOSITORY_NAME="$(printf '%s' "$REMOTE_URL" | sed -E 's#(\.git)$##; s#^.*[:/]([^/]+/[^/]+)$#\1#')"
else
    REPOSITORY_NAME="$(jq -r '.repository.url // .repository // ""' package.json |
        sed -E 's#(\.git)$##; s#^.*[:/]([^/]+/[^/]+)$#\1#')"
fi
[ -n "$REPOSITORY_NAME" ] || REPOSITORY_NAME="spearo-app/spearo-windy-plugin"
REPOSITORY_OWNER="${REPOSITORY_NAME%%/*}"

PLUGIN_NAME="$(jq -r '.name' package.json)"
PLUGIN_VERSION="$(jq -r '.version' package.json)"

echo "Плагин:      $PLUGIN_NAME@$PLUGIN_VERSION"
echo "Репозиторий: $REPOSITORY_NAME (owner: $REPOSITORY_OWNER)"
echo "Коммит:      $COMMIT_SHA"
echo "Endpoint:    $UPLOAD_URL"

# ── 3. Сборка ─────────────────────────────────────────────────────────────────
echo "→ npm run build"
npm run build >/dev/null

# ── 4. Архив (точно как в workflow) ───────────────────────────────────────────
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

jq -n \
    --arg repositoryName "$REPOSITORY_NAME" \
    --arg commitSha "$COMMIT_SHA" \
    --arg repositoryOwner "$REPOSITORY_OWNER" \
    '{repositoryName: $repositoryName, commitSha: $commitSha, repositoryOwner: $repositoryOwner}' \
    >"$TMP_DIR/plugin-info.json"

cd "$ROOT/dist"
jq -s '.[0] * .[1]' plugin.json "$TMP_DIR/plugin-info.json" >"$TMP_DIR/plugin.merged.json"
mv "$TMP_DIR/plugin.merged.json" plugin.json
tar cf "$TMP_DIR/plugin.tar" .
echo "→ архив: $(wc -c <"$TMP_DIR/plugin.tar" | tr -d ' ') байт"

if [ "$DRY_RUN" = "1" ]; then
    echo "--dry-run: отправка пропущена. Содержимое архива:"
    tar tf "$TMP_DIR/plugin.tar"
    exit 0
fi

# ── 5. Загрузка (ключ — через --config, не через argv) ────────────────────────
CURL_CONFIG="$TMP_DIR/curl.conf"
umask 077
# Ещё раз глушим трассировку: это единственная строка, где ключ разворачивается.
{ set +x; } 2>/dev/null
printf 'header = "x-windy-api-key: %s"\n' "$API_KEY" >"$CURL_CONFIG"
unset API_KEY

echo "→ загрузка…"
# -q ПЕРВЫМ аргументом: игнорируем любой ~/.curlrc (он мог бы подсунуть прокси,
# свои заголовки или запись тела в файл). Тело ответа не печатаем сырым — только
# разобранные поля: в нём могут быть служебные данные аккаунта.
RESPONSE="$(curl -q -s --fail-with-body --config "$CURL_CONFIG" \
    -X POST "$UPLOAD_URL" -F "plugin_archive=@$TMP_DIR/plugin.tar")" || STATUS=$?
rm -f "$CURL_CONFIG"

# Печатаем ТОЛЬКО installUrl / url / message / error — без сырого тела и заголовков.
redacted() {
    printf '%s' "$1" | jq -r '
        if type == "object" then
            [ (.installUrl // .url // empty), (.message // empty), (.error // empty) ]
            | map(select(. != null and . != "")) | .[]
        else empty end
    ' 2>/dev/null || true
}

if [ "${STATUS:-0}" != "0" ]; then
    echo "Загрузка не удалась (curl exit ${STATUS})." >&2
    SUMMARY="$(redacted "$RESPONSE")"
    [ -n "$SUMMARY" ] && echo "$SUMMARY" >&2
    exit "${STATUS}"
fi

SUMMARY="$(redacted "$RESPONSE")"
[ -n "$SUMMARY" ] && echo "$SUMMARY"

PLUGIN_URL="$(printf '%s' "$RESPONSE" | jq -r '(.installUrl // .url // empty)' 2>/dev/null || true)"
if [ -z "$PLUGIN_URL" ]; then
    PLUGIN_URL="$(printf '%s' "$SUMMARY" | grep -oE 'https://windy-plugins\.com/[^" ]+' | head -1 || true)"
fi
if [ -n "$PLUGIN_URL" ]; then
    echo
    echo "URL плагина: $PLUGIN_URL"
else
    echo
    echo "URL в ответе не найден — он должен иметь вид" \
        "https://windy-plugins.com/<userId>/$PLUGIN_NAME/$PLUGIN_VERSION/plugin.min.js"
fi
