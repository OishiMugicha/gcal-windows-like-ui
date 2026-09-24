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

## 公開

React + TypeScript + Viteの静的アプリです。`npm run build` の出力は `dist/` です。独自バックエンド・データベースは不要です。

このプロジェクトにはSites用のホスティング設定を追加しています。公開URLのオリジンをGoogle Cloudに登録した後、同じクライアントIDをサイトの設定に入力できます。

Cloudflare Pagesへ直接移す場合は、ビルドコマンド `npm run build`、出力ディレクトリ `dist`、Node.js 24を指定します。自分専用運用ではOAuthのテストユーザーを自分に限定します。

## 構成と検証

- `src/calendar.ts`: 日本時間の日付計算、翌日範囲、重複レイアウト。
- `src/TimeGrid.tsx`: 高さに追従する時間軸とポインター操作。
- `src/google.ts`: 認可、ページ送り取得、予定の作成・更新・削除、ETagによる競合検出。
- `src/EventEditor.tsx`: 予定フォームと削除確認。
- `tests/`: 実ブラウザの操作テストと模擬Google APIによる失敗・再接続のテスト。

Google APIテストは模擬APIです。実アカウントでの認可と読み書きはクライアントID設定後に別途確認してください。

WebMCP対応ブラウザでは表示時間帯設定用のツールも登録します。未対応ブラウザでは通常の設定画面だけを使います。
