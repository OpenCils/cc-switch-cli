<div align="center">

**[English](./README.en.md) | [中文](./README.md) | [日本語](./README.ja.md) | 한국어**

</div>

<div align="center">
  <img src="./preview.png" alt="CC Switch CLI terminal preview" width="100%" />
  <h1>CC Switch CLI</h1>
  <p>Claude Code, Codex, Gemini, OpenClaw의 모델·프로바이더·실행 환경을 하나의 터미널에서 전환합니다.</p>
  <p>
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-2f6f44?style=for-the-badge&logo=node.js&logoColor=white">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-2f5d95?style=for-the-badge&logo=typescript&logoColor=white">
    <img alt="Ink" src="https://img.shields.io/badge/Ink-6.8-24292f?style=for-the-badge">
    <img alt="TUI" src="https://img.shields.io/badge/Interface-Terminal_UI-a56a17?style=for-the-badge">
  </p>
</div>

<p align="center">
  단순한 설정 파일 편집기가 아닙니다. 설치된 환경을 자동으로 탐지하고, 도구와 환경 기준으로 프로바이더를 전환하며, 필요 시 ATO 프록시를 자동으로 실행합니다.
</p>

## 이 도구가 해결하는 것

여러 AI 코딩 툴을 함께 사용할 때 가장 불편한 건 모델 자체가 아니라 설정 파일 관리입니다:

- Claude Code는 `settings.json`
- Codex는 `config.toml`
- Gemini와 OpenClaw는 각자의 형식
- Windows와 WSL은 별개의 환경

`CC Switch CLI`는 이 모든 것을 하나의 터미널 UI로 통합합니다. 설치 환경을 선택하고, 프로바이더를 선택하고, Enter를 누르면 설정 파일 반영과 프록시 관리는 자동으로 처리됩니다.

## 주요 기능

| 기능 | 설명 |
| --- | --- |
| 멀티 툴 전환 | Claude Code, Codex, Gemini, OpenClaw 지원 |
| 멀티 환경 탐지 | Windows, 네이티브 Linux/macOS, WSL 배포판 자동 스캔 |
| 네이티브 설정 반영 | 툴에 맞게 `settings.json`, `config.toml`, `openclaw.json` 직접 수정 |
| 프로바이더 관리 | 설치 환경별로 여러 프로바이더 설정을 저장하고 활성 항목 관리 |
| ATO 프록시 | Claude Code를 OpenAI 호환 API에 연결. 자동 시작/종료, 포트 충돌 회피, 백그라운드 상주 지원 |
| 종료 관리 | 종료 시 ATO를 백그라운드에서 유지할지 함께 종료할지 명시적으로 선택 |

## 설치

### WSL / Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.sh | bash
```

### Windows (PowerShell)

```powershell
irm https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.ps1 | iex
```

설치 후 아무 터미널에서나 `cc`를 입력하면 실행됩니다. 터미널을 재시작하거나 `source ~/.bashrc`를 실행해야 PATH가 적용됩니다.

### 소스에서 실행 (개발자)

```bash
git clone https://github.com/OpenCils/cc-switch-cli.git
cd cc-switch-cli
npm install
npm start
```

## 사용 방법

1. 첫 화면에 탐지된 설치 목록이 표시됩니다 (예: `Claude Code [Linux]`, `Codex [WSL: Ubuntu-24.04]`)
2. 설치 환경을 선택하면 해당 프로바이더 목록을 관리할 수 있습니다
3. 프로바이더를 활성화하면 모델, URL, API 키가 해당 툴의 설정 파일에 반영됩니다
4. ATO가 활성화된 프로바이더를 선택하면 프록시 포트와 프로세스 생명주기가 자동으로 관리됩니다
5. 종료 시 ATO를 백그라운드에서 계속 실행할지 함께 종료할지 선택합니다

## 키보드 단축키

| 화면 | 키 | 동작 |
| --- | --- | --- |
| 진입 화면 | `↑` / `↓` | 커서 이동 |
| 진입 화면 | `Enter` | 설치 환경 진입 |
| 진입 화면 | `q` / `Esc` | 종료 확인 열기 |
| 전체 | `Ctrl+C` | 종료 확인 열기 |
| 폼 화면 | `Tab` / `Shift+Tab` | 필드 전환 |
| 폼 화면 | `Enter` | 다음 필드 또는 제출 |
| 폼 화면 | `Ctrl+S` | 저장 |
| 폼 화면 | `Esc` | 취소 |

## ATO 동작 방식

프로바이더 설정에서 `ATO 프록시 경유`를 활성화하면 CC Switch는:

1. Claude Code를 로컬 ATO 포트로 연결
2. Anthropic 형식 요청을 OpenAI Responses API 형식으로 변환
3. 응답을 다시 Anthropic 형식으로 변환해 반환
4. 프록시를 독립된 프로세스로 실행하여 TUI 종료 후에도 세션 유지

기본 포트는 `18653`입니다. 포트가 이미 사용 중이면 다음 빈 포트를 자동으로 찾아 저장합니다.

## 설정 파일

| 위치 | 용도 |
| --- | --- |
| `~/.cc-switch.json` | CC Switch 자체 프로바이더 저장소 및 활성 상태 |
| 각 툴 네이티브 설정 파일 | 프로바이더 활성화 시 반영 |
| `~/.cc-switch-ato/` | ATO 프로세스 기록 |

## 이런 분께 추천

- 여러 AI 코딩 CLI를 자주 전환하며 사용하는 개발자
- Windows와 WSL을 함께 사용하는 분
- Claude Code를 OpenAI 호환 모델에 연결하고 싶은 분
- 설정 파일을 직접 수정하는 게 번거로운 분

## 현황

- GitHub Releases를 통해 사전 컴파일된 독립 실행 바이너리 배포. Node.js나 npm 불필요
- Linux x64, macOS ARM64, Windows x64 지원
- `Ink` 기반 터미널 UI. 웹 패널이 아닙니다
