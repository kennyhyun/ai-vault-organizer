#!/usr/bin/env bash

OBSIDIAN_VAULT="${OBSIDIAN_VAULT:-/Users/kenny/ObsidianVaults/KennyGollum}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# launchd/cron은 shell profile 미로드 → PATH 보강
export PATH="${HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:${PATH}"
TODAY="$(date +%Y-%m-%d)"
NOW="$(date +%H:%M:%S)"
LOG_FILE="${OBSIDIAN_VAULT}/_history/${TODAY}.md"

trap 'log_error "예상치 못한 오류 (line $LINENO): $BASH_COMMAND"' ERR
trap 'ELAPSED=$(( $(date +%s) - START_TIME )); log ""; log "- 소요시간: ${ELAPSED}초"' EXIT

log() {
    echo "$1" >> "${LOG_FILE}"
}

log_error() {
    log "- **ERROR:** $1"
}

init_log() {
    if [ ! -f "${LOG_FILE}" ]; then
        echo "# Daily Organize — ${TODAY}" >> "${LOG_FILE}"
    fi
    log ""
    log "---"
    log "## Run @ ${NOW}"
    log ""
}

if [ ! -d "${OBSIDIAN_VAULT}" ]; then
    echo "ERROR: OBSIDIAN_VAULT not found: ${OBSIDIAN_VAULT}" >&2
    exit 1
fi
mkdir -p "${OBSIDIAN_VAULT}/_history"

init_log

collect_changed_files() {
    cd "${OBSIDIAN_VAULT}" || { log_error "vault 경로 없음: ${OBSIDIAN_VAULT}"; exit 1; }

    # 미커밋 파일 있으면 먼저 커밋
    if ! git diff --quiet || ! git diff --cached --quiet || \
       [ -n "$(git ls-files --others --exclude-standard)" ]; then
        git add .
        git commit -m "auto: pre-organize snapshot $(date +%Y-%m-%dT%H:%M:%S)" \
            && log "- pre-organize 커밋 완료" \
            || log_error "pre-organize 커밋 실패"
    fi

    # 최근 24시간 이내 변경된 .md 파일 수집 (git log 기준)
    CHANGED_FILES=()
    while IFS= read -r f; do
        [ -n "$f" ] && [ -f "${OBSIDIAN_VAULT}/${f}" ] && CHANGED_FILES+=("$f")
    done < <(git log --since="24 hours ago" --name-only --pretty=format: \
             | grep '\.md$' | sort -u)

    if [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
        log "- 변경 파일 없음 (최근 24시간)"
        log ""
        log "### 오류"
        log "- 없음"
        exit 0
    fi

    log "수집된 파일 수 (최근 24시간 변경): ${#CHANGED_FILES[@]}"
}

build_prompt() {
    local vault_tree
    vault_tree="$(cd "${OBSIDIAN_VAULT}" && tree -I '_history|.git|.obsidian' --noreport 2>/dev/null || find . -name '*.md' | head -50)"

    local files_content=""
    for f in "${CHANGED_FILES[@]}"; do
        files_content+="### ${f}"$'\n'
        files_content+="$(cat "${OBSIDIAN_VAULT}/${f}" 2>/dev/null || echo '[읽기 실패]')"$'\n\n'
    done

    # templates/ 폴더 내용 수집
    local templates_content="(템플릿 없음)"
    if [ -d "${SCRIPT_DIR}/templates" ] && [ -n "$(ls "${SCRIPT_DIR}/templates/"*.md 2>/dev/null)" ]; then
        templates_content=""
        for t in "${SCRIPT_DIR}/templates/"*.md; do
            local tname
            tname="$(basename "$t")"
            templates_content+="### ${tname}"$'\n'
            templates_content+="$(cat "$t")"$'\n\n'
        done
    fi

    local template
    template="$(cat "${SCRIPT_DIR}/prompt-template.txt")" || { log_error "prompt-template.txt 읽기 실패"; return 1; }
    PROMPT="${template/\{\{VAULT_TREE\}\}/${vault_tree}}"
    PROMPT="${PROMPT/\{\{CHANGED_FILES_CONTENT\}\}/${files_content}}"
    # wordcount threshold 초과 파일 목록
    local word_threshold="${WORD_THRESHOLD:-500}"
    local long_files_content="(없음)"
    local long_files=()
    if [ -f "${SCRIPT_DIR}/wordcount.sh" ]; then
        for f in "${CHANGED_FILES[@]}"; do
            local wc
            wc=$(bash "${SCRIPT_DIR}/wordcount.sh" "${OBSIDIAN_VAULT}/${f}" 2>/dev/null || echo 0)
            [ "$wc" -gt "$word_threshold" ] && long_files+=("- ${f} (${wc} words)")
        done
        [ "${#long_files[@]}" -gt 0 ] && long_files_content="$(printf '%s\n' "${long_files[@]}")"
    fi

    PROMPT="${PROMPT/\{\{TEMPLATES_CONTENT\}\}/${templates_content}}"
    PROMPT="${PROMPT/\{\{LONG_FILES_CONTENT\}\}/${long_files_content}}"
    PROMPT="${PROMPT/\{\{WORD_THRESHOLD\}\}/${word_threshold}}"
}

run_chat() {
    if [ "${KIRO_DRY_RUN:-}" = "1" ]; then
        log "- [DRY RUN] 프롬프트 길이: ${#PROMPT} chars"
        return 0
    fi

    local output exit_code
    output="$(echo "${PROMPT}" | bash "${SCRIPT_DIR}/chat.sh" 2>&1)"
    exit_code=$?

    if [ $exit_code -ne 0 ]; then
        log_error "chat.sh 실패 (exit ${exit_code}): ${output}"
        return 1
    fi

    echo "${output}" | sed 's/\x1b\[[0-9;]*m//g' \
        | sed -n '/### 처리된 파일/,/### 오류/p' >> "${LOG_FILE}"
}

run_chat_with_retry() {
    if ! run_chat; then
        log "- 배치 분할 재시도 중..."
        local mid=$(( ${#CHANGED_FILES[@]} / 2 ))
        local first=("${CHANGED_FILES[@]:0:${mid}}")
        local second=("${CHANGED_FILES[@]:${mid}}")

        CHANGED_FILES=("${first[@]}"); build_prompt; run_chat || log_error "배치 1/2 실패"
        CHANGED_FILES=("${second[@]}"); build_prompt; run_chat || log_error "배치 2/2 실패"
    fi
}

commit_and_push() {
    cd "${OBSIDIAN_VAULT}" || return 1

    git add .
    if git diff --cached --quiet; then
        log "- git: 커밋할 변경사항 없음"
        return 0
    fi

    if ! git commit -m "chore: daily organize ${TODAY}"; then
        log_error "git commit 실패"
        return 1
    fi

    if ! git push 2>/dev/null; then
        log "- git: push 스킵 (remote 없거나 실패) — 로컬 커밋 유지"
        return 0
    fi

    log "- git: commit + push 완료"
}

START_TIME=$(date +%s)
collect_changed_files
build_prompt || { log "### 오류"; log "- 프롬프트 생성 실패 (prompt-template.txt 없음)"; exit 1; }
log "### 처리된 파일"
run_chat_with_retry
commit_and_push
