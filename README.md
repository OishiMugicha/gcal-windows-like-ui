# Calendar 95

Windows 95風の、個人用Google Calendarクライアントです。サイドバーを設けず、日・週・月カレンダーを大きく表示します。

## 開発環境

この環境ではWSL Ubuntuの既存Node.js **24.20.0**（nvm）とnpm **11.19.0**を使用しています。Node.jsの追加インストールは行っていません。Gitリポジトリは `main` ブランチで管理しています。

WSLターミナルで実行してください。

```bash
cd ~/Projects/gcal-windows-like-ui
source ~/.nvm/nvm.sh
nvm use
npm ci
npm run dev
```

依存関係の導入後は `bash scripts/dev.sh` でも起動できます。
開発URL: http://localhost:5173

```bash
npm test       # 日時計算・境界・重複配置のテスト
npm run build # TypeScriptチェックと本番ビルド
```

ブラウザテストは開発サーバーを起動した状態で実行します。この環境ではブラウザを追加インストールせず、Windows側の既存EdgeとNode.jsで実施しています。Windows PowerShellから:

```powershell
& '\\wsl$\Ubuntu\home\nagao\Projects\gcal-windows-like-ui\scripts\test-browser.ps1'
```

別環境でPlaywrightのブラウザが導入済みなら `npm run test:e2e` を使えます。

## 使い方

- 初期表示: 月曜始まり・7日・8:00〜翌2:00、日本標準時（Asia/Tokyo）。
- 「設定」で開始・終了時刻を30分単位で変更。「終了は翌日」で深夜まで表示。範囲は30分〜24時間、全曜日共通です。
- 日・週表示は時間軸の上端・下端を固定し、画面の高さに合わせて伸縮します。月表示は通常の暦日表示です。
- 月曜の列の0:30は火曜0:30です。目盛りに「翌」は付けず、編集画面では実際の日付を表示します。
- 時間外の予定は隠します。境界にまたがる予定は見える部分だけ表示し、切れている端を破線にします。
- 終日は上部に表示。多い場合は「ほか○件」を開いて確認できます。
- 空き枠のクリック・ドラッグで作成、予定のドラッグで移動、上下端のドラッグで長さ変更。ドラッグは15分単位です。
- キーボードでは「＋ 予定」と予定ボタンからフォームを開けます。Escapeで閉じます。
- スマホでは日表示が初期表示です。予定のタップからフォームで編集します。
- サンプル表示の変更はGoogleに送られず、再読み込みでリセットされます。
- 表示設定と選択カレンダーはブラウザに保存します。予定データ・アクセストークンは永続保存しません。
- 繰り返し予定は選択した1回のみ変更・削除できます。シリーズ全体の編集、招待者管理、通知設定はGoogle Calendar側で行ってください。
- 編集時のカレンダー間移動は未対応です。新規作成では作成先を選択できます。

## Google Calendarを接続する

Google Cloudの設定はアカウント所有者が行います。クライアントシークレットはこのアプリでは使用しません。

1. [Google Cloud Console](https://console.cloud.google.com/)でプロジェクトを作成または選択します。
2. 「APIとサービス」から **Google Calendar API** を有効にします。
3. 「Google Auth Platform」でアプリ名・サポート用メールなどを設定します。個人利用なら対象をExternal、公開状態をTestingとし、自分のGoogleメールアドレスをテストユーザーに追加します。組織アカウントでは管理者の制限に従ってください。
4. データアクセスのスコープに以下を追加します。
   - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
   - `https://www.googleapis.com/auth/calendar.events`
5. 「クライアント」から種類 **ウェブアプリケーション** のOAuthクライアントIDを作成します。
6. 「承認済みのJavaScript生成元」に `http://localhost:5173` と、公開後のサイトのHTTPSオリジンを登録します。パスや末尾のスラッシュは付けません。このトークン方式ではリダイレクトURIを使用しません。
7. サイトの「設定 → Google接続設定」に、末尾が `.apps.googleusercontent.com` のクライアントIDを入力し、「適用」します。
8. 「Googleに接続」を押し、使用するアカウントを選択して、カレンダー一覧と予定へのアクセスを許可します。
9. 接続後、「設定」で表示するカレンダーを選択します。共有の読み取り専用カレンダーは閲覧のみです。

クライアントIDを開発環境に設定する方法もあります。`.env.example` を `.env.local` にコピーし、`VITE_GOOGLE_CLIENT_ID` を設定して開発サーバーを再起動します。クライアントIDは公開識別子ですが、アクセストークンやクライアントシークレットは記入しないでください。

ブラウザ再読み込み後やアクセストークンの有効期限切れには再接続が必要です。期限切れ時に入力中の予定がある場合は、編集画面内の「入力を保持してGoogleに再接続」で接続を回復してから保存できます。バックグラウンドの自動同期・オフライン編集は行いません。

接続解除はこのブラウザ内の接続を消します。Google側のアクセス許可も取り消す場合は、[Googleアカウントの接続管理](https://myaccount.google.com/connections)を利用してください。

### エラー時

- origin_mismatch: JavaScript生成元がアクセス中のオリジンと一致しているか確認してください。
- access_denied: テストユーザー登録、必要なスコープへの同意、組織の管理ポリシーを確認してください。
- APIの403: Calendar API有効化とカレンダーの編集権限を確認してください。
- 保存結果不明: すぐに別の新規予定を作らず、カレンダーを更新して保存済みか確認してください。フォーム内の再試行は同じ予定IDを使い、二重登録を防ぎます。
- 他の場所で変更された予定: 編集画面を閉じて更新し、最新の予定を開き直してください。

参考: [Googleのトークン方式](https://developers.google.com/identity/oauth2/web/guides/use-token-model)、[繰り返し予定のAPI](https://developers.google.com/workspace/calendar/api/guides/recurringevents)。

## 自分用に公開する（Cloudflare Pages）

React + TypeScript + Viteの静的アプリです。`npm run build` の出力は `dist/` です。独自バックエンド・データベースは不要です。

Cloudflare Pagesの無料枠で、標準の `https://<プロジェクト名>.pages.dev` に公開します。画面は誰でも開けますが、あなたの予定を取得するにはあなたのGoogle認証が必要です。未接続時はサンプルを表示します。

### 1. GitHubのリポジトリを使う

公開元は [OishiMugicha/gcal-windows-like-ui](https://github.com/OishiMugicha/gcal-windows-like-ui) の `main` ブランチです。非公開リポジトリのままでも連携できます。`dist/` やZIPをGitHubへ追加する必要はありません。

`.env.local`、OAuthトークン、クライアントシークレット、個人の予定はコミットしません。クライアントIDは公開後の設定画面で入力できるため、ビルド時の環境変数設定は不要です。

### 2. Cloudflare PagesとGitHubを連携する

1. [Cloudflareダッシュボード](https://dash.cloudflare.com/)にログインします。
2. **Workers & Pages → Create application** から **Pages** のGitリポジトリ接続を選びます。WorkersではなくPagesを選択してください。
3. GitHubを接続し、CloudflareのGitHubアプリに `OishiMugicha/gcal-windows-like-ui` のアクセスを許可します。リポジトリを選んでセットアップへ進みます。
4. 以下を設定し、**Save and Deploy** を押します。

| 項目 | 設定値 |
| --- | --- |
| プロジェクト名 | `calendar95-personal`（使用済みなら別名） |
| 本番ブランチ | `main` |
| フレームワーク | Vite（なければNoneで下記を手入力） |
| ビルドコマンド | `npm test && npm run build` |
| ビルド出力ディレクトリ | `dist` |
| ルートディレクトリ | 空欄（リポジトリのルート） |
| 環境変数 | `NODE_VERSION=24.20.0`（`.nvmrc`と同じ） |

5. ビルドが成功したら、発行された本番URLを控えます。

以後、`main` へのpushでテスト・ビルド・本番公開が自動実行されます。GitHub ActionsやCloudflare APIトークンの追加は不要です。`public/_headers` はビルド時にコピーされ、Google認証ポップアップ用の `Cross-Origin-Opener-Policy: same-origin-allow-popups` などが適用されます。

Direct Uploadで作成済みのプロジェクトがある場合は、Git連携用のPagesプロジェクトを新しく作成します。[CloudflareのGit連携手順](https://developers.cloudflare.com/pages/get-started/git-integration/)

### 3. 公開URLでGoogleに接続する

1. 上の「Google Calendarを接続する」に従ってCalendar APIとOAuthクライアントを設定します。個人利用では **External / Testing** とし、自分のメールアドレスだけをテストユーザーに登録します。
2. 「承認済みのJavaScript生成元」に、発行された本番URL（例: `https://calendar95-personal.pages.dev`）を追加します。パスや末尾の `/` は付けません。リダイレクトURIは不要です。
3. 本番URLを開き、「設定 → Google接続設定」にクライアントIDを入力して適用します。
4. 「Googleに接続」で自分のアカウントを選択し、カレンダーを選びます。別の端末やブラウザでもクライアントIDの入力とGoogle認証が必要です。

### 4. 公開後の確認

- PCとスマホでHTTPSの本番URLを開き、日・週・月表示を確認します。
- シークレットウィンドウなど未接続のブラウザではサンプルだけが表示されることを確認します。
- 自分のアカウントで接続し、実際のカレンダーが取得できることを確認します。
- 自分の書き込み可能なカレンダーに動作確認用の予定を1件作成し、変更・削除します。Google Calendar側にも反映されることを確認します。
- 再読み込み後にGoogleへ再接続できることを確認します。認証エラーは上の「エラー時」を参照してください。
- ブラウザの開発者ツールで、HTMLレスポンスに上記の `Cross-Origin-Opener-Policy` ヘッダーがあることを確認します。

### 更新する

WSLのNode.jsで `npm test` と `npm run build` を実行してから、変更したソースを小さな単位でコミットし、`git push origin main` で反映します。Cloudflare PagesのDeploymentsでビルド・公開の成功を確認してください。本番URLが同じなら、Googleの生成元設定を変更する必要はありません。

ビルドが失敗した場合はDeploymentsのログを確認し、修正して再度pushします。公開後に不具合が見つかった場合は、原因のコミットをrevertしてpushします。

`.openai/hosting.json` は既存のSites用設定です。Cloudflare Pagesでは使用しません。

## 構成と検証

- `src/calendar.ts`: 日本時間の日付計算、翌日範囲、重複レイアウト。
- `src/TimeGrid.tsx`: 高さに追従する時間軸とポインター操作。
- `src/google.ts`: 認可、ページ送り取得、予定の作成・更新・削除、ETagによる競合検出。
- `src/EventEditor.tsx`: 予定フォームと削除確認。
- `tests/`: 実ブラウザの操作テストと模擬Google APIによる失敗・再接続のテスト。

Google APIテストは模擬APIです。実アカウントでの認可と読み書きはクライアントID設定後に別途確認してください。

WebMCP対応ブラウザでは表示時間帯設定用のツールも登録します。未対応ブラウザでは通常の設定画面だけを使います。
