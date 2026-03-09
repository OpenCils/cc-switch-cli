<div align="center">

**[English](./README.en.md) | [中文](./README.md) | 日本語 | [한국어](./README.ko.md)**

</div>

<div align="center">
  <img src="./preview.png" alt="CC Switch CLI terminal preview" width="100%" />
  <h1>CC Switch CLI</h1>
  <p>Claude Code、Codex、Gemini、OpenClaw のモデル・プロバイダー・実行環境を、ひとつのターミナルで切り替える。</p>
  <p>
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-20%2B-2f6f44?style=for-the-badge&logo=node.js&logoColor=white">
    <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5.9-2f5d95?style=for-the-badge&logo=typescript&logoColor=white">
    <img alt="Ink" src="https://img.shields.io/badge/Ink-6.8-24292f?style=for-the-badge">
    <img alt="TUI" src="https://img.shields.io/badge/Interface-Terminal_UI-a56a17?style=for-the-badge">
  </p>
</div>

<p align="center">
  単なる設定ファイルエディタではありません。インストール済みの環境を自動検出し、ツールと環境の軸でプロバイダーを切り替え、必要に応じて ATO プロキシを自動起動します。
</p>

## このツールが解決すること

複数の AI コーディングツールを使い分けていると、モデル自体よりも設定ファイルの管理が煩雑になります：

- Claude Code は `settings.json`
- Codex は `config.toml`
- Gemini と OpenClaw はそれぞれ独自の形式
- Windows と WSL では環境がまったく別々になりがち

`CC Switch CLI` はこれらをひとつのターミナル UI に集約します。インストール先を選んでプロバイダーを選んで Enter を押すだけ。設定の書き戻しとプロキシの管理は自動で行います。

## 主な機能

| 機能 | 説明 |
| --- | --- |
| マルチツール切り替え | Claude Code、Codex、Gemini、OpenClaw に対応 |
| マルチ環境検出 | Windows、Linux/macOS、WSL ディストリビューションを自動スキャン |
| ネイティブ設定書き戻し | ツールに合わせて `settings.json`、`config.toml`、`openclaw.json` を直接書き換え |
| プロバイダー管理 | インストール先ごとに複数のプロバイダー設定を保存し、アクティブなものを管理 |
| ATO プロキシ | Claude Code を OpenAI 互換 API に橋渡し。自動起動・停止、ポート競合回避、バックグラウンド常駐に対応 |
| 終了管理 | 終了時に ATO をバックグラウンドで継続するか、一括停止するかを明示的に選択 |

## インストール

### WSL / Linux / macOS

```bash
curl -fsSL https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.sh | bash
```

### Windows（PowerShell）

```powershell
irm https://raw.githubusercontent.com/OpenCils/cc-switch-cli/main/install.ps1 | iex
```

インストール後、任意のターミナルで `cc` と入力すると起動します。PATH の反映にはターミナルの再起動、または `source ~/.bashrc` の実行が必要です。

### ソースから実行（開発者向け）

```bash
git clone https://github.com/OpenCils/cc-switch-cli.git
cd cc-switch-cli
npm install
npm start
```

## 使い方

1. 最初の画面に検出されたインストール一覧が表示されます（例：`Claude Code [Linux]`、`Codex [WSL: Ubuntu-24.04]`）
2. インストール先を選ぶと、そのプロバイダーリストを管理できます
3. プロバイダーをアクティブにすると、モデル・URL・API キーがそのツールの設定ファイルに書き戻されます
4. ATO が有効なプロバイダーを選んだ場合、プロキシのポートとプロセスのライフサイクルが自動で管理されます
5. 終了時に ATO をバックグラウンドで継続するか停止するかを選択できます

## キーボード操作

| 画面 | キー | 動作 |
| --- | --- | --- |
| エントリー画面 | `↑` / `↓` | カーソル移動 |
| エントリー画面 | `Enter` | インストール先へ進む |
| エントリー画面 | `q` / `Esc` | 終了確認を開く |
| 全画面共通 | `Ctrl+C` | 終了確認を開く |
| フォーム画面 | `Tab` / `Shift+Tab` | フィールド切り替え |
| フォーム画面 | `Enter` | 次のフィールドまたは送信 |
| フォーム画面 | `Ctrl+S` | 保存 |
| フォーム画面 | `Esc` | キャンセル |

## ATO の仕組み

プロバイダー設定で「ATO プロキシ経由」を有効にすると、CC Switch は：

1. Claude Code をローカルの ATO ポートに向ける
2. Anthropic 形式のリクエストを OpenAI Responses API 形式に変換
3. レスポンスを Anthropic 形式に変換して返す
4. プロキシをデタッチされた独立プロセスとして実行し、TUI 終了後も継続

デフォルトポートは `18653`。使用中の場合は次の空きポートを自動検索して記録します。

## 設定ファイル

| 場所 | 用途 |
| --- | --- |
| `~/.cc-switch.json` | CC Switch 自身のプロバイダー設定とアクティブ状態 |
| 各ツールのネイティブ設定ファイル | プロバイダーアクティブ化時に書き戻し |
| `~/.cc-switch-ato/` | ATO プロセス記録 |

## こんな方に

- 複数の AI コーディング CLI を頻繁に切り替えて使う方
- Windows と WSL を混在させて作業する方
- Claude Code を OpenAI 互換モデルに接続したい方
- 設定ファイルを手動で編集するのに疲れた方

## 現状

- GitHub Releases でコンパイル済みスタンドアロンバイナリを配布。Node.js や npm は不要
- Linux x64、macOS ARM64、Windows x64 に対応
- `Ink` ベースのターミナル UI。Web パネルではありません
