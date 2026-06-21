#!/usr/bin/env bash
# Usage: wordcount.sh [--verbose] <file.md>
# Counts words in markdown, excluding frontmatter, headings, images, tables, code blocks, HTML

VERBOSE=0
FILE=""
for arg in "$@"; do
    case "$arg" in
        --verbose) VERBOSE=1 ;;
        *) FILE="$arg" ;;
    esac
done

[ -z "$FILE" ] && { echo "Usage: wordcount.sh [--verbose] <file.md>" >&2; exit 1; }
[ ! -f "$FILE" ] && { echo "0"; exit 0; }

content="$(cat "$FILE")"

# 1. frontmatter 제거 (--- ... ---)
content="$(echo "$content" | awk '
    BEGIN { fm=0; first=1 }
    /^---$/ && first { fm=1; first=0; next }
    /^---$/ && fm    { fm=0; next }
    !fm { print }
')"

# 2. 코드블록 제거 (mermaid 포함)
content="$(echo "$content" | awk '
    /^```/ { in_code=!in_code; next }
    !in_code { print }
')"

# 3. 이미지 제거
content="$(echo "$content" | sed 's/!\[\[[^]]*\]\]//g; s/!\[[^]]*\]([^)]*)//g')"

# 4. 표 제거
content="$(echo "$content" | grep -v '^[[:space:]]*|')"

# 5. 제목 마커 제거 (단어는 유지)
content="$(echo "$content" | sed 's/^#\+[[:space:]]*//')"

# 6. HTML 태그 제거
content="$(echo "$content" | sed 's/<[^>]*>//g')"

# 7. 단어 수 계산
count=$(echo "$content" | tr -s '[:space:]' '\n' | grep -c '\S' 2>/dev/null || echo 0)

if [ "$VERBOSE" = "1" ]; then
    echo "File: $FILE"
    echo "Words: $count"
else
    echo "$count"
fi
