#!/usr/bin/env bash
# AI 백엔드 래퍼 — stdin으로 프롬프트 받고 stdout으로 결과 출력
# 플러그인 설정의 "chat.sh 내용" 편집기에서 수정 가능
PROMPT="$(cat)"
kiro-cli chat --no-interactive --trust-all-tools "${PROMPT}"
