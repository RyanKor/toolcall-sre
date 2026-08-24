import type { Dict } from "./ko";

const ja: Dict = {
  meta: {
    title: "toolcall-sre コンソール",
    description: "ローカル LLM ツールコール信頼性プロキシの計器盤・試験台・フライトレコーダー",
  },

  common: {
    brandTag: "ローカル LLM のツールコール信頼性プロキシ",
    language: "言語",
    refresh: "更新",
    run: "実行",
    running: "実行中…",
    add: "追加",
    edit: "編集",
    remove: "削除",
    cancel: "取消",
    save: "保存",
    check: "確認",
    checking: "確認中…",
    use: "使用",
    waiting: "待機",
    loading: "読み込み中…",
    none: "—",
    unobserved: "未観測",
    yes: "はい",
    no: "いいえ",
    notApplicable: "該当なし",
    ms: (n: number) => `${n}ms`,
    session: "セッション",
    turns: "ターン",
    toolCalls: "ツールコール",
    model: "モデル",
    backend: "バックエンド",
    proxyUnreachable: "プロキシに接続できません",
    proxyCheckHint: "toolcall-sre が起動しているか確認してください。",
  },

  nav: {
    observe: "観測",
    setup: "設定",
    dashboard: "計器盤",
    dashboardSub: "SLI・セッション・回復",
    lab: "試験台",
    labSub: "失敗シナリオの再現",
    inspect: "エンジン試験",
    inspectSub: "パーサ／検証器だけ",
    trace: "フライトレコーダー",
    traceSub: "リクエストごとの判定",
    models: "モデル",
    modelsSub: "バックエンド登録・比較",
    connections: "プロキシ接続",
    connectionsSub: "インスタンス・レジストリ",
  },

  badge: {
    proxy: "プロキシ",
    connected: "接続済み",
    disconnected: "未接続",
    policy: (p: string) => `ポリシー ${p}`,
    streamRepair: "ストリーム修復",
    normalize: "正規化",
    goToConnections: "プロキシ接続",
    goToConnectionsTail: "でアドレスを確認してください。",
  },

  actions: {
    passthrough: "そのまま通過",
    normalized: "正規化",
    recovered: "パーサが復旧",
    repaired: "修復済み",
    left_by_policy: "ポリシーにより拒否",
    left_no_schema: "スキーマなし",
    repair_failed: "修復失敗",
    declined: "モデルが推測を拒否",
  },

  violation: {
    syntacticLabel: "形式の誤り",
    syntacticWhy:
      "値は呼び出しの中にあり、形だけが誤っています。作り出すものが何もないため、文脈なしで直しても安全です。",
    fabricatingLabel: "情報の欠落",
    fabricatingWhy:
      "必須の値がそもそも存在しません。文脈なしで直せと言われたモデルは値を作り出します — これが静かな誤動作の出どころです。",
  },

  dashboard: {
    eyebrow: "01 — 計器盤",
    title: "いま何が起きているか",
    lead1: "観測がなければ比率は",
    lead2: "ではなく",
    lead3: "未観測",
    lead4:
      "と表示されます。分母が 0 のときに満点を報告するダッシュボードは、嘘をついているからです。",
    autoOn: "自動更新オン（2秒）",
    autoOff: "自動更新オフ",

    fabricatedHeadline: (n: number) => `このプロキシは値を ${n} 回作り出しました`,
    fabricationRate: (r: string) => `捏造率 ${r}`,
    fabricatedBody1: (repaired: number, fabricated: number) =>
      `修復に成功した ${repaired} 件のうち ${fabricated} 件は、元の呼び出しにも会話の文脈にもなかった値を埋めています。形式は完璧でも、`,
    fabricatedBodyEmph: "事実でないかもしれない",
    fabricatedBody2: "引数がツールに渡ったということです。取り消せないツールがあるなら ",
    fabricatedBody3: " で保護してください。",

    reliability: "ツールコール信頼性",
    observedCalls: (n: number) => `観測したツールコール ${n} 件`,
    wellFormedRate: "正常率",
    wellFormedRateNote: "初回でスキーマまで通った割合",
    recovered: "パーサが復旧",
    recoveredNote: "モデル往復 0 回・コスト 0",
    repairSuccess: "修復成功率",
    repairSuccessNote: (n: number) => `試行 ${n} 件が分母（malformed 全体ではない）`,
    fabricated: "捏造の発生",
    fabricatedNote: "文脈になかった値を埋めた修復",
    skipped: "ポリシーにより拒否",
    skippedNote: "作り出す必要があるため直さなかった件（失敗ではない）",
    exhausted: "修復失敗",
    exhaustedNote: "試行したが予算を使い切った",

    splitClean: "そのまま正常",
    splitRecovered: "パーサが復旧",
    splitRepaired: "修復済み",
    splitFabricated: "捏造を含む修復",
    splitSkipped: "拒否",
    splitFailed: "修復失敗",

    inHarness: "ハーネスの中での挙動",
    inHarnessHintA: "単位は個々のコールではなく ",
    inHarnessHintB: "タスク一件全体",
    inHarnessHintC: "です",
    cleanRate: "全区間ノーミス",
    cleanRateNote: (n: number) => `ツールを使ったセッション ${n} 件が分母`,
    sessions: "セッション",
    sessionsNote: (live: number, retired: number) => `稼働 ${live}・退役 ${retired}`,
    avgTurns: "平均ターン",
    avgTurnsNote: "タスク一件あたりの往復",
    recovery: "ツール失敗からの回復",
    recoveryNote: (n: number) => `観測したツール失敗 ${n} 件`,

    latency: "レイテンシ・ストリーミング",
    latencyHint: "信頼性をどれだけの遅延で買ったか",
    p50: "リクエスト p50",
    p50Note: (n: number) => `${n} 件観測`,
    p95: "リクエスト p95",
    repairAdded: "修復が足した時間 p95",
    repairAddedNote: (n: number) => `修復 ${n} 回`,
    streamMeasured: "ストリーム観測",
    streamMeasuredNote: (n: number) => (n > 0 ? `未観測通過 ${n} 件` : "すべて観測済み"),
    streamRepaired: "ストリーム修復",
    streamRepairedNote: "バッファ後に再送出",
    upstreamErrors: "アップストリーム失敗",

    sessionsTable: "セッション",
    sessionsTableHint: "新しい順・最大 50 件",
    colSession: "セッション",
    colTurns: "ターン",
    colCalls: "コール",
    colRecovered: "復旧",
    colRepaired: "修復",
    colFabricated: "捏造",
    colToolErrors: "ツール失敗",
    colVerdict: "判定",
    colSequence: "呼び出し順",
    noToolCalls: "ツールコールなし",
    clean: "ノーミス",
    dirty: "汚染",
    recoveredChip: "回復",
    heuristicTitle: "テキスト推定で拾った件（信頼度低）",
    emptySessionsA: "まだセッションがありません。",
    emptySessionsB: "試験台",
    emptySessionsC: "でシナリオを実行してみてください。",
  },

  lab: {
    eyebrow: "02 — 試験台",
    title: "失敗を選んで再現する",
    lead1:
      "各ボタンはローカルモデルが実際にやらかす失敗ひとつです。モックのアップストリームがこのアプリの中にあるので、モデルも GPU も要りません。実行すると ",
    leadEmph: "モデルが何を送り、クライアントが何を受け取り、プロキシがなぜそう判断したか",
    lead2: "を並べて表示します。",

    backendLabel: "どのバックエンドに送るか",
    backendDefault: "既定のバックエンド（--upstream）",
    backendNote1: "以下のシナリオは ",
    backendNoteEmph: "シナリオモック",
    backendNote2:
      "が再生するものです。実際のモデルを選べば、そのモデルが本当に何を出すかを見ることになります。下の行が今回の実行で送られる ",
    backendNote3: " の値をそのまま示します。バックエンドの登録は ",
    backendNote4: " 画面で行います。",

    streaming: "ストリーミング",
    blindContext: "文脈に答えなし",
    resultTitle: (name: string) => `実行結果 — ${name}`,
    requestFailed: "リクエスト失敗",

    elapsed: "所要",
    elapsedNote: (n: number) => `うち修復 ${n}ms`,
    response: "応答",
    finishReason: "finish_reason",
    countedFinal: "完了として集計",
    notFinal: "完了ではない",
    toolCallCount: "ツールコール",
    streamMode: "ストリーミング",
    nonStreamMode: "非ストリーミング",

    modelSent: "モデルが送ったもの",
    clientGot: "クライアントが受け取ったもの",
    missingRequired: "欠けている必須項目:",
    fabricatedHeadline: "これらの値は作り出されたものです",
    fabricatedBody1:
      "元の呼び出しにも、ユーザーの依頼にも、直前のツール結果にも、この値はありませんでした。修復はスキーマを満たしましたが、",
    fabricatedBodyEmph: "事実を作り出しました。",
    fabricatedBody2:
      " 決済・削除・送信のように取り消せないツールだったなら、ここで誤った実行が起きます。",
    validationError: "検証エラー",

    noToolCall: "ツールコールなし — テキスト応答",
    notCountedFinal: "完了として集計しない",
    truncatedNote:
      "トークン上限で切れた応答です。パッチ前はこれも「モデルが仕事を終えた」として集計され、回復力の指標を水増ししていました。",
    finalNote: "正常に終了し中身も空でないので、本物の完了です。",
    rawSse: "クライアントが実際に受け取った SSE 原文",
    using: "いま何を相手に試しているか",
    usingBackend: "バックエンド",
    usingModel: "送出される model 値",
    usingModelScenario: "シナリオ名",
    usingUrl: "アドレス",
    usingKind: "種別",
    kindMock: "モック再生",
    kindReal: "実モデル",
    kindMockNote:
      "下のシナリオ名がそのまま model フィールドとして送られ、モックが再生する失敗の種類を選びます。モデルは一切呼ばれません。",
    kindRealNote: (m: string) =>
      `実モデルなので model フィールドには ${m} が入ります。シナリオはどの課題を送るかだけを決め、失敗の内容はこのモデルが実際に出したそのものです。`,
    resultBackend: "バックエンド",
    resultModel: "モデル",
  },

  inspect: {
    eyebrow: "03 — エンジン試験",
    title: "モデルなしでパーサと検証器だけを回す",
    lead1: "プロキシの ",
    lead2:
      " はアップストリームを一切呼びません。引数ひとつとスキーマひとつを渡せば、",
    leadEmph: "解析 → 検証 → 分類 → ポリシー判断",
    lead3:
      "までどう流れるかを即答します。エンジンをライブ実行の副産物ではなく、それ自体として試験できるようにする場所です。",

    inputs: "入力",
    presetHint: "プリセットを押すとすぐ埋まります",
    argsLabel: "function.arguments（モデルが送った文字列）",
    schemaLabel: "function.parameters（JSON Schema）",
    toolLabel: "ツール名",
    badSchema: "スキーマが正しい JSON ではありません。",
    inspectFailed: "検査に失敗しました",
    noModel: "モデル呼び出しなし",
    noModelNote:
      "この画面はモデルを一切呼び出しません。プロキシのパーサ・検証器・ポリシーだけをその場で実行するため、結果はモデルやバックエンドの状態に関係なく常に同じです。",
    policyLabel: "適用中のポリシー",

    presets: {
      clean: "正常",
      cleanNote: "そのまま通過",
      prose: "あいさつ混入",
      proseNote: "パーサが復旧",
      fenced: "コードフェンス",
      fencedNote: "パーサが復旧",
      comma: "末尾カンマ",
      commaNote: "パーサが復旧",
      type: "型の誤り",
      typeNote: "形式の誤り → 修復可能",
      enum: "enum 外",
      enumNote: "形式の誤り → 修復可能",
      missing: "必須欠落",
      missingNote: "情報の欠落 → 作り出すしかない",
      empty: "空の引数",
      emptyNote: "引数なしツールの正常な作法",
      garbage: "JSON でない",
      garbageNote: "復旧不能",
    },

    verdict: "判定",
    policyIs: (p: string) => `ポリシー ${p}`,
    parsing: "解析",
    parseOk: "成功",
    parseFail: "失敗",
    parseRecovered: "寛容なパーサが復旧しました",
    parsePlain: "そのままで有効な JSON",
    schemaCheck: "スキーマ検証",
    schemaPass: "通過",
    schemaFail: "違反",
    schemaNone: "スキーマ未指定",
    violationType: "違反の種類",
    violationMissing: "情報の欠落",
    violationSyntactic: "形式の誤り",
    violationMissingNote: "直すには作り出すしかない",
    violationSyntacticNote: "値はある・安全に修復可能",
    argShape: "引数の形",
    argObject: "オブジェクト",
    argString: "文字列",
    argObjectNote: "Ollama ネイティブの形",
    argStringNote: "OpenAI 標準",

    whatProxyDoes: "プロキシがやること",
    withContextNote:
      "修復プロンプトに会話の文脈を載せ、根拠がなければ推測せず拒否するよう指示します。",
    missingLabel: "欠落:",
    parsedResult: "解析結果",
    errorLabel: "エラー",
  },

  trace: {
    eyebrow: "04 — フライトレコーダー",
    title: "リクエスト一つひとつに何をなぜしたか",
    lead1:
      "プロキシがメモリに保持している直近の記録です。集計値はここから出ています — 指標がおかしく見えたら、その数字を作った個別の判定を直接開けなければなりません。",
    lead2: " を付けて起動すれば同じ内容が JSONL にも残ります。",

    loadFailed: "イベントを読み込めません",
    filterPlaceholder: "セッションで絞り込み…",
    filterAll: "すべて",
    filterProblem: "問題のあるものだけ",
    filterInvent: "捏造だけ",
    kept: (kept: number, cap: number, shown: number) => `${kept}/${cap} 保持・${shown} 表示`,
    emptyA: "記録がありません。",
    emptyB: "試験台",
    emptyC: "でシナリオを実行してみてください。",

    turn: (n: number) => `ターン ${n}`,
    stream: "ストリーム",
    done: "完了",
    finishedWith: (r: string) => `終了 ${r}`,
    invented: "捏造",
    repairTook: (n: number) => `（修復 ${n}ms）`,
    turnMismatch: (declared: number, actual: number) =>
      `履歴が言うターン ${declared} ≠ 実際 ${actual}`,
    toolResults: (count: number, errors: number, heuristic: number) =>
      `返されたツール結果 ${count}・失敗 ${errors}${heuristic > 0 ? `（推定 ${heuristic}）` : ""}`,
    parseChip: (ok: boolean) => `解析 ${ok ? "OK" : "失敗"}`,
    parserRecovered: "パーサ復旧",
    schemaChip: (ok: boolean) => `スキーマ ${ok ? "OK" : "違反"}`,
    missingChip: (f: string) => `欠落 ${f}`,
    inventedChip: (f: string) => `捏造 ${f}`,
    rawRecord: "生の記録（JSONL 一行）",
  },

  models: {
    eyebrow: "06 — モデル",
    title: "複数のバックエンドを登録し、同じ物差しで比べる",
    lead1: "登録したバックエンドはプロキシのレジストリに ",
    leadAlias: "エイリアス",
    lead2: "として入ります。リクエストヘッダ ",
    lead3: " ひとつで行き先が分かれるので、",
    leadEmph: "プロキシ一つ・ポリシー一つ・指標一つ",
    lead4:
      "で複数モデルを比較できます。ヘッダが運ぶのはアドレスではなくエイリアスです — 任意のアドレスへ転送するプロキシは SSRF の道具になるからです。",

    adminBlocked: "このプロキシはコンソールからのバックエンド登録を許可していません",
    adminBlockedHint:
      "一覧の編集は保存されますがプロキシには反映されません。--allow-admin を付けて起動するか、--upstream-alias エイリアス=アドレス で登録してください。",

    registry: "登録済みバックエンド",
    addBackend: "バックエンドを追加",
    colAlias: "エイリアス",
    colLabel: "名前",
    colUrl: "アドレス",
    colModelId: "モデル id",
    colProbe: "接続確認",
    keyStored: "キー保存済み",
    probeUnknown: "未確認",
    probeReached: (ms: number) => `到達 ${ms}ms`,
    probeModels: (n: number, mismatch: boolean) =>
      `モデル ${n} 件${mismatch ? "・id 不一致" : ""}`,
    probeFailed: "失敗",

    editTitle: "バックエンドを編集",
    addTitle: "バックエンドを追加",
    aliasField: "エイリアス・ヘッダに載る値",
    labelField: "名前",
    urlField: "OpenAI 互換アドレス（/v1 を含む）",
    modelIdField: "モデル id・リクエストの model フィールドとして送られます",
    apiKeyField: "API キー（任意）・ブラウザには返しません",
    apiKeyPlaceholderEdit: "空欄なら既存のキーを維持",
    notesField: "メモ（任意）",
    saveAndRegister: "保存してプロキシに登録",
    badAlias: "エイリアスは英数字・`-`・`_`・`.` のみ使えます。",
    savedAndSynced: (n: number, total: number) =>
      `保存し、プロキシに ${n}/${total} 件を登録しました。`,
    savedButBlocked: (hint: string) =>
      `保存しました。ただしプロキシが実行時登録を拒否しています — ${hint}`,

    burst: "比較実行",
    burstHint: "同じ課題を各バックエンドに同じ回数",
    runsPerBackend: "バックエンドあたりのリクエスト",
    blindOn: "文脈に答えなし",
    blindOff: "文脈に答えあり",
    blindTitle: "リクエストの文脈に都市／単位が含まれるか",
    burstProgress: (done: number, total: number) => `実行中 ${done}/${total}`,
    burstNote1: "文脈に答えなし",
    burstNote2:
      "が既定です。この状態でしか「修復は成功したが値は作り出した」場合が見えないからです。答えが文脈にあれば同じ修復も回収として分類され、捏造率はほぼ 0 になります — 二つの設定を切り替えれば違いがすぐ分かります。",

    comparison: "モデル別の信頼性",
    comparisonHint: "プロキシが集計した値・3 秒ごとに更新",
    emptyA: "まだ測定されたツールコールがありません。上の ",
    emptyB: "比較実行",
    emptyC: " を押してみてください。",

    bestModel: "最も正常率が高い",
    compared: "比較対象",
    comparedNote: "（モデル, バックエンド）の組",
    totalCalls: "総ツールコール",
    totalFabricated: "総捏造",
    totalFabricatedNote: "修復が作り出した値",

    thModel: "モデル",
    thBackend: "バックエンド",
    thCalls: "コール",
    thWellFormed: "正常率",
    thComposition: "内訳",
    thFabRate: "捏造率",
    thClean: "全区間ノーミス",
    thLatency: "平均遅延",
    sessionsOf: (clean: number, total: number) => `${clean}/${total} セッション`,
    repairAdds: (ms: number) => `+${ms}ms 修復`,

    partClean: "正常",
    partRecovered: "パーサ復旧",
    partRepaired: "修復",
    partFabricated: "捏造",
    partUnrepaired: "未修復",

    footnote1: "正常率",
    footnote2: "はコール単位、",
    footnote3: "全区間ノーミス",
    footnote4:
      "はセッション単位です。実際に効くのは後者です — コールあたり 95% でも 8 ステップで 66% に崩れます。二つの列が大きく開くなら、そのモデルは「たまに間違える」のではなく「長い仕事を終えられない」のです。",

    curlTitle: "直接呼ぶとき",
    curlComment1: "# ハーネスでバックエンドを選ぶ方法: ヘッダ一行",
    curlComment2:
      "# ヘッダを省くと --upstream で指定した既定のバックエンドに行きます。\n# 未登録のエイリアスは 400 で拒否します — 黙って別のモデルに流れると\n# ベンチマーク結果が別のモデルに紐づいてしまうからです。",
  },

  connections: {
    eyebrow: "05 — プロキシ接続",
    title: "どの toolcall-sre を見ているか",
    lead1: "コンソールは ",
    leadEmph: "常にサーバ側から",
    lead2:
      "プロキシを呼びます。だからプロキシに CORS 設定は不要で、別の機材で動いているプロキシもアドレスだけで繋がり、保存した API キーはブラウザに降りてきません。",

    status: "接続状態",
    connectHint:
      "toolcall-sre が起動しているか、下のアドレスが正しいか確認してください。下の「起動コマンド」はそのままコピーして使えます。",
    stateLabel: "状態",
    connected: "接続済み",
    policyLabel: "修復ポリシー",
    streamingLabel: "ストリーミング",
    streamingBoth: "観測 + 修復",
    streamingMeasure: "観測のみ",
    streamingPass: "通過",
    streamingPassNote: "ストリーミングが観測されていません",
    adminLabel: "実行時登録",
    adminOn: "許可",
    adminOff: "ロック",
    adminOnNote: "コンソールからバックエンドを追加できます",
    adminOffNote: "--allow-admin が必要",

    registered: "登録済みプロキシ",
    colName: "名前",
    colUrl: "アドレス",
    colState: "状態",
    inUseConnected: "使用中・接続済み",
    inUseDisconnected: "使用中・切断",
    namePlaceholder: "リモート GPU サーバ",
    labelOptional: "名前（任意）",
    urlLabel: "アドレス",
    testConnection: "接続テスト",
    duplicate: (label: string) => `すでに登録済みのアドレスです —「${label}」に切り替えました。`,
    probeOk: (policy: string, ms: number) => `接続済み・ポリシー ${policy}・${ms}ms`,
    probeFail: "接続失敗",
    serverSideNote1: "アドレスは ",
    serverSideNoteEmph: "このコンソールサーバ",
    serverSideNote2:
      "（Next プロセス）から見た基準です。ブラウザ基準ではありません — 別の機材から見ていても、プロキシがコンソールと同じ機材で動いているなら ",
    serverSideNote3: " が正解です。",

    registryTitle: "このプロキシのバックエンドレジストリ",
    pushModels: "コンソールのモデル一覧を流し込む",
    registryNote1: "プロキシのレジストリは ",
    registryNoteEmph: "メモリ上だけ",
    registryNote2:
      "にあり、プロセスが死ぬと消えます。コンソールが原本をファイルで保持して流し直す構造なので、プロキシの再起動が事件になりません。同じエイリアスを再登録すると上書きされるので、何度押しても安全です。",
    registryUnreadable: "レジストリを読み取れません。",
    colSource: "由来",
    sourceAdmin: "コンソール登録",
    sourceFlag: "起動オプション",
    isDefault: "既定",
    synced: (n: number, total: number) =>
      `バックエンド ${n}/${total} 件をこのプロキシに登録しました。`,
    syncFailed: (hint: string) => `登録に失敗しました: ${hint}`,

    runCommand: "起動コマンド",
    runCommandHint: "コンソールが前提としている設定そのまま",
    runCommandBody: `# コンソールのモックバックエンドを使い、実行時登録を許可して起動
cargo run --release -- \\
  --listen 127.0.0.1:8091 \\
  --upstream http://127.0.0.1:3100/api/mock/v1 \\
  --repair-policy contextual \\
  --repair-streaming \\
  --allow-admin

# 実際のバックエンドを使うときは --upstream だけ変えます
#   vLLM   http://127.0.0.1:8000/v1
#   Ollama http://127.0.0.1:11434/v1`,
    adminWarn1:
      " は既定でオフです。オンにするとリクエストの行き先を実行時に追加できてしまい SSRF の面が生まれるため、プロキシはこのオプションが有効なままループバック以外のアドレスにバインドすると ",
    adminWarnEmph: "起動を拒否します",
    adminWarn2: "。オンにしたくなければ、バックエンドを ",
    adminWarn3: " で起動時に登録してください — コンソールは読み取り専用でそのまま表示します。",
  },

  policy: {
    OffLabel: "off — 観測のみ",
    OffNote: "直さず記録だけします。モデルの素の成績を測るとき。",
    SyntacticOnlyLabel: "syntactic-only — 安全な既定値",
    SyntacticOnlyNote: "値がある形式の誤りだけ直します。ない値は決して作り出しません。",
    ContextualLabel: "contextual",
    ContextualNote:
      "欠けた値も直しますが、会話の文脈を載せ、根拠がなければ拒否させます。",
    FullLabel: "full — 危険",
    FullNote:
      "文脈なしで何でも直します。モデルが値を作り出します。副作用のないツール専用。",
  },

  expect: {
    passthrough: "そのまま通過",
    recovered: "パーサが復旧",
    repaired: "修復済み",
    fabricated: "修復・捏造警告",
    refused: "ポリシーにより拒否",
    failed: "修復失敗",
    final: "最終回答",
    observed: "モデルにより異なる",
  },

  group: {
    normal: "正常",
    syntax: "形式の誤り",
    missing: "情報の欠落",
    argshape: "引数の形",
    finish: "応答の終わり方",
    streaming: "ストリーミング",
    complex: "複雑なツール",
  },

  scenario: {
    cleanTitle: "正常なツールコール",
    cleanNote: "手を触れずそのまま通すべきです。キーの順序まで保たれます。",
    proseTitle: "あいさつ + 末尾カンマ",
    proseNote:
      "寛容なパーサだけで復旧します。モデルに聞き直さないのでコストも遅延も 0 です。元のバイト列はクライアントが読めないので、必ず書き直す必要があります。",
    fencedTitle: "Markdown コードフェンス",
    fencedNote: "フェンスを剥がせば正常な JSON です。",
    badEnumTitle: "enum の外の値",
    badEnumNote:
      "値は存在し意図も明確です（\"C\" = celsius）。作り出すものがないので、文脈なしで直しても安全です。",
    wrongTypeTitle: "型の誤り + 必須欠落",
    wrongTypeNote:
      "location が数値です。元に都市名がないので、直すには作り出すしかありません。",
    missingCtxTitle: "必須項目の欠落 — 文脈に答えがある",
    missingCtxNote:
      "unit がありませんが、ユーザーが celsius と言っています。文脈からの回収であって捏造ではありません。",
    missingBlindTitle: "必須項目の欠落 — 文脈にも答えがない",
    missingBlindNote:
      "これが核心の事例です。どこにも単位の情報がないのに修復は成功します。捏造として表示されなければなりません。",
    garbageCtxTitle: "そもそも JSON でない — 文脈に答えがある",
    garbageCtxNote:
      "復旧すべき JSON がないので修復モデルが全部埋めます。ただしユーザーの依頼に都市と単位があるので、回収であって捏造ではありません。",
    garbageBlindTitle: "そもそも JSON でない — どこにも答えがない",
    garbageBlindNote:
      "元にも文脈にも根拠がないのに修復は成功します。すべて捏造です — 最も危険な組み合わせです。",
    objectArgsTitle: "arguments がオブジェクト（Ollama ネイティブ）",
    objectArgsNote:
      "パッチ前は空文字列として読まれ malformed に集計され、まともなコールを修復で上書きしかねませんでした。",
    emptyArgsTitle: '引数なしツールを "" で呼ぶ',
    emptyArgsNote:
      "パラメータのない関数の正常な作法です。パッチ前は malformed に集計され、無駄な修復まで試みていました。",
    finalTitle: "正常な最終回答",
    finalNote: "ツールコールなしで終わった本物の完了です。",
    truncatedTitle: "トークン上限で切れた",
    truncatedNote:
      "パッチ前はこれも「完了」として集計され、回復力の指標を水増ししていました。",
    streamCleanTitle: "ストリーミングの正常なツールコール",
    streamCleanNote:
      "パッチ前はストリーミングだと観測すらしませんでした。いまは遅延なしで観測されます。",
    streamProseTitle: "ストリーミング + あいさつ混入",
    streamProseNote: "デルタを組み立て直して復旧し、正常な SSE として再送出します。",
    streamMissingTitle: "ストリーミング + 情報の欠落",
    streamMissingNote: "ストリーミングでも捏造検出が同じように動く必要があります。",

    scheduleFullTitle: "複雑な予約 — 情報は十分",
    scheduleFullNote:
      "入れ子オブジェクト・配列・二階層下の enum が混じったスキーマです。必要な情報はすべて文に含めて送ります。実モデルがこの深さの構造を崩さず組み立てられるかを試します。",
    scheduleBlindTitle: "複雑な予約 — 参加者情報が欠落",
    scheduleBlindNote:
      "正確な時刻・通話リンク・参加者双方のメールと役割をわざと空けています。入れ子の配列項目の中でも創作検知が同じように働くか、実モデルが値を作り出すのか聞き返すのかを見ます。",

    emitsFenced: "```json\\n{...}\\n```",
    emitsObjectArgs: '{"location":"Seoul","unit":"celsius"}（文字列ではなくオブジェクト）',
    emitsEmptyArgs: '""（空文字列）',
    emitsFinal: '"It is 21 degrees in Seoul." (finish_reason: stop)',
    emitsTruncated: '"It is 21 deg" (finish_reason: length)',
    emitsStreamClean: "断片化したデルタで届く正常な JSON",
    emitsStreamProse: '"Sure! {...,}" が 7 バイトずつ断片化して到着',
    emitsStreamMissing: '{"location":"Seoul"} が断片化して到着',
  },

  seed: {
    localProxy: "ローカルプロキシ",
    solidLabel: "模擬 · 堅いモデル",
    solidNote: "ツールコールをほとんど間違えません。フロンティア API に近い挙動。",
    flakyLabel: "模擬 · ぐらつくモデル",
    flakyNote: "プロズ混入と必須項目の欠落が混ざります。典型的な小さいローカルモデル。",
    roughLabel: "模擬 · 粗いモデル",
    roughNote: "半分以上が壊れます。ツール調整されていない小型モデル。",
    scenarioLabel: "模擬 · シナリオ指定",
    scenarioNote: "試験台が使うバックエンド。`model` フィールドが失敗の種類を選びます。",
  },
  errors: {
    proxy_unreachable: "プロキシに接続できません",
    proxy_status: "プロキシがエラーを返しました",
    admin_disabled: "プロキシが実行時登録を許可していません",
    admin_disabled_hint:
      "toolcall-sre を --allow-admin で起動するか、--upstream-alias でバックエンドを登録してください。",
    not_toolcall_sre: "応答はありましたが toolcall-sre ではないようです",
    bad_scheme: "http:// または https:// で始まる必要があります",
    timeout: "応答なし（5 秒超過）",
    unknown: "不明なエラー",
  },
};

export default ja;
