/**
 * Korean — the source of truth for the dictionary shape.
 *
 * Every other locale is typed as `Dict`, so a missing or misnamed key is a
 * compile error rather than a string that silently falls back to Korean.
 * Interpolation is done with plain functions instead of a template syntax, which
 * means TypeScript also checks that each translation takes the same arguments.
 */

const ko = {
  meta: {
    title: "toolcall-sre 콘솔",
    description: "로컬 LLM 툴콜 신뢰성 프록시의 계기판 · 시험대 · 블랙박스",
  },

  common: {
    brandTag: "로컬 LLM 툴콜 신뢰성 프록시",
    language: "언어",
    refresh: "새로고침",
    run: "실행",
    running: "실행 중…",
    add: "추가",
    edit: "편집",
    remove: "삭제",
    cancel: "취소",
    save: "저장",
    check: "확인",
    checking: "확인 중…",
    use: "사용",
    waiting: "대기",
    loading: "불러오는 중…",
    none: "—",
    unobserved: "관측 전",
    yes: "예",
    no: "아니오",
    notApplicable: "해당 없음",
    ms: (n: number) => `${n}ms`,
    session: "세션",
    turns: "턴",
    toolCalls: "툴콜",
    model: "모델",
    backend: "백엔드",
    proxyUnreachable: "프록시에 연결할 수 없습니다",
    proxyCheckHint: "toolcall-sre가 실행 중인지 확인하세요.",
  },

  nav: {
    observe: "관측",
    setup: "설정",
    dashboard: "계기판",
    dashboardSub: "SLI · 세션 · 회복력",
    lab: "시험대",
    labSub: "실패 시나리오 재현",
    inspect: "엔진 시험",
    inspectSub: "파서/검증기 단독",
    trace: "블랙박스",
    traceSub: "요청별 판정 기록",
    models: "모델",
    modelsSub: "백엔드 등록 · 비교",
    connections: "프록시 연결",
    connectionsSub: "인스턴스 · 레지스트리",
  },

  badge: {
    proxy: "프록시",
    connected: "연결됨",
    disconnected: "연결 안 됨",
    policy: (p: string) => `정책 ${p}`,
    streamRepair: "스트림수리",
    normalize: "정규화",
    goToConnections: "프록시 연결",
    goToConnectionsTail: "에서 주소를 확인하세요.",
  },

  actions: {
    passthrough: "그대로 통과",
    normalized: "정규화",
    recovered: "파서가 복구",
    repaired: "수리됨",
    left_by_policy: "정책상 거부",
    left_no_schema: "스키마 없음",
    repair_failed: "수리 실패",
    declined: "모델이 추측 거부",
  },

  violation: {
    syntacticLabel: "형식 위반",
    syntacticWhy:
      "값은 호출 안에 있고 형태만 잘못됐습니다. 고쳐도 새로 지어낼 것이 없으므로 맥락 없이 수리해도 안전합니다.",
    fabricatingLabel: "정보 결손",
    fabricatingWhy:
      "필수 값이 아예 없습니다. 맥락 없이 고치라고 하면 모델은 지어냅니다 — 이것이 조용한 오작동의 출처입니다.",
  },

  dashboard: {
    eyebrow: "01 — 계기판",
    title: "지금 무슨 일이 일어나고 있나",
    lead1: "비율은 관측이 없으면",
    lead2: "가 아니라",
    lead3: "관측 전",
    lead4:
      "으로 표시됩니다. 분모가 0일 때 완벽한 점수를 보고하면 대시보드가 거짓말을 하기 때문입니다.",
    autoOn: "자동 갱신 켜짐 (2초)",
    autoOff: "자동 갱신 꺼짐",

    fabricatedHeadline: (n: number) => `이 프록시는 값을 ${n}번 지어냈습니다`,
    fabricationRate: (r: string) => `창작률 ${r}`,
    fabricatedBody1: (repaired: number, fabricated: number) =>
      `수리에 성공한 ${repaired}건 중 ${fabricated}건은, 원래 호출에도 대화 맥락에도 없던 값을 채워 넣었습니다. 형식은 완벽하지만 `,
    fabricatedBodyEmph: "사실이 아닐 수 있는",
    fabricatedBody2: " 인자가 도구로 전달됐다는 뜻입니다. 되돌릴 수 없는 도구가 있다면 ",
    fabricatedBody3: " 로 보호하세요.",

    reliability: "툴콜 신뢰성",
    observedCalls: (n: number) => `관측된 툴콜 ${n}건`,
    wellFormedRate: "정상 비율",
    wellFormedRateNote: "첫 시도에 스키마까지 통과한 비율",
    recovered: "파서가 복구",
    recoveredNote: "모델 왕복 0회 · 비용 0",
    repairSuccess: "수리 성공률",
    repairSuccessNote: (n: number) => `시도 ${n}건 기준 (malformed 전체가 아님)`,
    fabricated: "창작 발생",
    fabricatedNote: "맥락에 없던 값을 채운 수리",
    skipped: "정책상 거부",
    skippedNote: "지어내야 해서 고치지 않은 건 (실패 아님)",
    exhausted: "수리 실패",
    exhaustedNote: "시도했으나 예산 소진",

    splitClean: "그대로 정상",
    splitRecovered: "파서가 복구",
    splitRepaired: "수리됨",
    splitFabricated: "창작 포함 수리",
    splitSkipped: "정책상 거부",
    splitFailed: "수리 실패",

    inHarness: "하네스 안에서의 행동",
    inHarnessHintA: "개별 콜이 아니라 ",
    inHarnessHintB: "업무 한 건 전체",
    inHarnessHintC: "가 단위입니다",
    cleanRate: "전 구간 무결점",
    cleanRateNote: (n: number) => `툴콜을 쓴 세션 ${n}건 기준`,
    sessions: "세션",
    sessionsNote: (live: number, retired: number) => `활성 ${live} · 퇴역 ${retired}`,
    avgTurns: "평균 턴",
    avgTurnsNote: "일 하나에 걸린 왕복",
    recovery: "도구 오류 후 회복",
    recoveryNote: (n: number) => `관측된 도구 오류 ${n}건`,

    latency: "지연 · 스트리밍",
    latencyHint: "신뢰성을 얼마의 지연으로 샀는가",
    p50: "요청 p50",
    p50Note: (n: number) => `${n}건 관측`,
    p95: "요청 p95",
    repairAdded: "수리가 더한 시간 p95",
    repairAddedNote: (n: number) => `수리 ${n}회`,
    streamMeasured: "스트리밍 측정",
    streamMeasuredNote: (n: number) => (n > 0 ? `미관측 통과 ${n}건` : "전부 관측됨"),
    streamRepaired: "스트리밍 수리",
    streamRepairedNote: "버퍼링 후 재발행",
    upstreamErrors: "업스트림 오류",

    sessionsTable: "세션",
    sessionsTableHint: "최근 활동 순 · 최대 50건",
    colSession: "세션",
    colTurns: "턴",
    colCalls: "툴콜",
    colRecovered: "복구",
    colRepaired: "수리",
    colFabricated: "창작",
    colToolErrors: "도구오류",
    colVerdict: "판정",
    colSequence: "호출 순서",
    noToolCalls: "툴콜 없음",
    clean: "무결점",
    dirty: "오염",
    recoveredChip: "회복",
    heuristicTitle: "텍스트 추정으로 잡힌 건 (신뢰도 낮음)",
    emptySessionsA: "아직 세션이 없습니다. ",
    emptySessionsB: "시험대",
    emptySessionsC: "에서 시나리오를 실행해 보세요.",
  },

  lab: {
    eyebrow: "02 — 시험대",
    title: "실패를 골라서 재현하기",
    lead1:
      "각 버튼은 로컬 모델이 실제로 저지르는 실수 하나입니다. 목업 업스트림이 이 앱 안에 있어 모델도 GPU도 필요 없습니다. 실행하면 ",
    leadEmph: "모델이 뭘 보냈는지, 클라이언트가 뭘 받았는지, 프록시가 왜 그렇게 판단했는지",
    lead2: "를 나란히 보여줍니다.",

    backendLabel: "어느 백엔드로 보낼까",
    backendDefault: "기본 백엔드 (--upstream)",
    backendNote1: "아래 시나리오들은 ",
    backendNoteEmph: "시나리오 목업",
    backendNote2: "이 재생하는 것입니다. 실제 모델을 고르면 그 모델이 실제로 무엇을 내놓는지 보게 됩니다 — 시나리오 이름은 그대로 ",
    backendNote3: " 필드로 나갑니다. 백엔드 등록은 ",
    backendNote4: " 화면에서 합니다.",

    streaming: "스트리밍",
    blindContext: "맥락에 답 없음",
    resultTitle: (name: string) => `실행 결과 — ${name}`,
    requestFailed: "요청 실패",

    elapsed: "소요",
    elapsedNote: (n: number) => `수리에 ${n}ms`,
    response: "응답",
    finishReason: "finish_reason",
    countedFinal: "완수로 집계",
    notFinal: "완수 아님",
    toolCallCount: "툴콜",
    streamMode: "스트리밍",
    nonStreamMode: "비스트리밍",

    modelSent: "모델이 보낸 것",
    clientGot: "클라이언트가 받은 것",
    missingRequired: "누락된 필수 항목:",
    fabricatedHeadline: "이 값들은 지어낸 것입니다",
    fabricatedBody1:
      "원래 호출에도, 사용자의 요청에도, 직전 도구 결과에도 이 값은 없었습니다. 수리는 스키마를 만족시켰지만 ",
    fabricatedBodyEmph: "사실을 만들어냈습니다.",
    fabricatedBody2:
      " 결제·삭제·발송처럼 되돌릴 수 없는 도구였다면 여기서 잘못된 실행이 일어납니다.",
    validationError: "검증 오류",

    noToolCall: "툴콜 없음 — 텍스트 응답",
    notCountedFinal: "완수로 집계하지 않음",
    truncatedNote:
      "토큰 한도로 잘린 응답입니다. 패치 전에는 이것도 '모델이 일을 끝냈다'로 집계되어 회복력 지표를 부풀렸습니다.",
    finalNote: "정상 종료했고 내용도 비어있지 않으므로 진짜 완수입니다.",
    rawSse: "클라이언트가 실제로 받은 SSE 원문",
  },

  inspect: {
    eyebrow: "03 — 엔진 시험",
    title: "모델 없이 파서와 검증기만 돌려보기",
    lead1: "프록시의 ",
    lead2: " 는 업스트림을 전혀 호출하지 않습니다. 인자 하나와 스키마 하나를 주면 ",
    leadEmph: "파싱 → 검증 → 분류 → 정책 판단",
    lead3:
      "까지 어떻게 흘러가는지 즉시 답합니다. 엔진을 라이브 실행의 부산물이 아니라 그 자체로 시험할 수 있게 하는 지점입니다.",

    inputs: "입력",
    presetHint: "프리셋을 누르면 바로 채워집니다",
    argsLabel: "function.arguments (모델이 보낸 문자열)",
    schemaLabel: "function.parameters (JSON Schema)",
    toolLabel: "도구 이름",
    badSchema: "스키마가 올바른 JSON이 아닙니다.",
    inspectFailed: "검사 실패",

    presets: {
      clean: "정상",
      cleanNote: "그대로 통과",
      prose: "인사말 혼입",
      proseNote: "파서가 복구",
      fenced: "코드펜스",
      fencedNote: "파서가 복구",
      comma: "트레일링 콤마",
      commaNote: "파서가 복구",
      type: "타입 오류",
      typeNote: "형식 위반 → 수리 가능",
      enum: "enum 밖",
      enumNote: "형식 위반 → 수리 가능",
      missing: "필수 누락",
      missingNote: "정보 결손 → 지어내야 함",
      empty: "빈 인자",
      emptyNote: "인자 없는 도구의 정상 관행",
      garbage: "JSON 아님",
      garbageNote: "복구 불가",
    },

    verdict: "판정",
    policyIs: (p: string) => `정책 ${p}`,
    parsing: "파싱",
    parseOk: "성공",
    parseFail: "실패",
    parseRecovered: "관대한 파서가 복구함",
    parsePlain: "그대로 유효한 JSON",
    schemaCheck: "스키마 검증",
    schemaPass: "통과",
    schemaFail: "위반",
    schemaNone: "스키마 미제공",
    violationType: "위반 유형",
    violationMissing: "정보 결손",
    violationSyntactic: "형식 위반",
    violationMissingNote: "고치려면 지어내야 함",
    violationSyntacticNote: "값은 있음 · 안전하게 수리 가능",
    argShape: "인자 형태",
    argObject: "객체",
    argString: "문자열",
    argObjectNote: "Ollama 네이티브 형태",
    argStringNote: "OpenAI 표준",

    whatProxyDoes: "프록시가 할 일",
    withContextNote:
      "수리 프롬프트에 대화 맥락을 실어 보내고, 근거가 없으면 추측 대신 거부하라고 지시합니다.",
    missingLabel: "누락:",
    parsedResult: "파싱 결과",
    errorLabel: "오류",
  },

  trace: {
    eyebrow: "04 — 블랙박스",
    title: "요청 하나하나에 대해 무엇을 왜 했는가",
    lead1:
      "프록시가 메모리에 들고 있는 최근 기록입니다. 집계 숫자는 여기서 나옵니다 — 지표가 이상해 보이면 그 숫자를 만든 개별 판정을 직접 확인할 수 있어야 합니다. ",
    lead2: " 로 실행하면 같은 내용이 JSONL로도 남습니다.",

    loadFailed: "이벤트를 불러올 수 없습니다",
    filterPlaceholder: "세션 필터…",
    filterAll: "전체",
    filterProblem: "문제 있는 것만",
    filterInvent: "창작만",
    kept: (kept: number, cap: number, shown: number) => `${kept}/${cap} 보관 · ${shown} 표시`,
    emptyA: "기록이 없습니다. ",
    emptyB: "시험대",
    emptyC: "에서 시나리오를 실행해 보세요.",

    turn: (n: number) => `턴 ${n}`,
    stream: "스트림",
    done: "완수",
    finishedWith: (r: string) => `종료 ${r}`,
    invented: "창작",
    repairTook: (n: number) => ` (수리 ${n}ms)`,
    turnMismatch: (declared: number, actual: number) =>
      `히스토리가 말하는 턴 ${declared} ≠ 실제 ${actual}`,
    toolResults: (count: number, errors: number, heuristic: number) =>
      `되먹은 도구 결과 ${count} · 오류 ${errors}${heuristic > 0 ? ` (추정 ${heuristic})` : ""}`,
    parseChip: (ok: boolean) => `파싱 ${ok ? "OK" : "실패"}`,
    parserRecovered: "파서 복구",
    schemaChip: (ok: boolean) => `스키마 ${ok ? "OK" : "위반"}`,
    missingChip: (f: string) => `누락 ${f}`,
    inventedChip: (f: string) => `지어냄 ${f}`,
    rawRecord: "원본 기록 (JSONL 한 줄)",
  },

  models: {
    eyebrow: "06 — 모델",
    title: "여러 백엔드를 등록하고, 같은 잣대로 비교하기",
    lead1: "등록된 백엔드는 프록시의 레지스트리에 ",
    leadAlias: "별칭",
    lead2: "으로 들어갑니다. 요청 헤더 ",
    lead3: " 하나로 목적지가 갈리므로, ",
    leadEmph: "프록시 하나 · 정책 하나 · 지표 하나",
    lead4:
      "로 여러 모델을 비교할 수 있습니다. 헤더가 나르는 것은 주소가 아니라 별칭입니다 — 임의 주소로 전달하는 프록시는 SSRF 도구가 되니까요.",

    adminBlocked: "이 프록시는 콘솔에서의 백엔드 등록을 허용하지 않습니다",
    adminBlockedHint:
      "목록 편집은 저장되지만 프록시에는 반영되지 않습니다. --allow-admin 으로 실행하거나, --upstream-alias 별칭=주소 로 등록하세요.",

    registry: "등록된 백엔드",
    addBackend: "백엔드 추가",
    colAlias: "별칭",
    colLabel: "이름",
    colUrl: "주소",
    colModelId: "모델 id",
    colProbe: "연결 확인",
    keyStored: "키 저장됨",
    probeUnknown: "미확인",
    probeReached: (ms: number) => `도달 ${ms}ms`,
    probeModels: (n: number, mismatch: boolean) => `모델 ${n}개${mismatch ? " · id 불일치" : ""}`,
    probeFailed: "실패",

    editTitle: "백엔드 편집",
    addTitle: "백엔드 추가",
    aliasField: "별칭 · 헤더에 실리는 값",
    labelField: "이름",
    urlField: "OpenAI 호환 주소 (/v1 포함)",
    modelIdField: "모델 id · 요청의 model 필드로 나감",
    apiKeyField: "API 키 (선택) · 브라우저로 다시 내려오지 않습니다",
    apiKeyPlaceholderEdit: "비워두면 기존 키 유지",
    notesField: "메모 (선택)",
    saveAndRegister: "저장하고 프록시에 등록",
    badAlias: "별칭은 영문·숫자·`-`·`_`·`.` 만 쓸 수 있습니다.",
    savedAndSynced: (n: number, total: number) =>
      `저장하고 프록시에 ${n}/${total}개 등록했습니다.`,
    savedButBlocked: (hint: string) =>
      `저장됨. 다만 프록시가 런타임 등록을 막고 있습니다 — ${hint}`,

    burst: "비교 실행",
    burstHint: "같은 과제를 각 백엔드에 동일 횟수로",
    runsPerBackend: "백엔드당 요청",
    blindOn: "문맥에 정답 없음",
    blindOff: "문맥에 정답 있음",
    blindTitle: "요청 문맥에 도시/단위가 들어있는지",
    burstProgress: (done: number, total: number) => `실행 중 ${done}/${total}`,
    burstNote1: "문맥에 정답 없음",
    burstNote2:
      "이 기본입니다. 이 상태에서만 “수리는 성공했는데 값은 지어낸” 경우가 드러나기 때문입니다. 정답이 문맥에 있으면 같은 수리도 회수로 분류되어 창작률이 0에 가깝게 나옵니다 — 두 설정을 번갈아 돌려보면 차이가 바로 보입니다.",

    comparison: "모델별 신뢰성",
    comparisonHint: "프록시가 집계한 값 · 3초마다 갱신",
    emptyA: "아직 측정된 툴콜이 없습니다. 위에서 ",
    emptyB: "비교 실행",
    emptyC: "을 눌러보세요.",

    bestModel: "가장 정상률 높음",
    compared: "비교 대상",
    comparedNote: "(모델, 백엔드) 쌍",
    totalCalls: "총 툴콜",
    totalFabricated: "총 창작",
    totalFabricatedNote: "수리가 지어낸 값",

    thModel: "모델",
    thBackend: "백엔드",
    thCalls: "툴콜",
    thWellFormed: "정상률",
    thComposition: "구성",
    thFabRate: "창작률",
    thClean: "전 구간 무결점",
    thLatency: "평균 지연",
    sessionsOf: (clean: number, total: number) => `${clean}/${total} 세션`,
    repairAdds: (ms: number) => `+${ms}ms 수리`,

    partClean: "정상",
    partRecovered: "파서복구",
    partRepaired: "수리",
    partFabricated: "창작",
    partUnrepaired: "미수리",

    footnote1: "정상률",
    footnote2: "은 콜 단위, ",
    footnote3: "전 구간 무결점",
    footnote4:
      "은 세션 단위입니다. 후자가 실제로 중요한 숫자입니다 — 콜당 95%도 8스텝이면 66%로 무너지니까요. 두 열이 크게 벌어진다면 그 모델은 “가끔 틀리는” 게 아니라 “긴 작업을 못 끝내는” 것입니다.",

    curlTitle: "직접 호출할 때",
    curlComment1: "# 하네스에서 백엔드를 고르는 방법: 헤더 한 줄",
    curlComment2:
      "# 헤더를 생략하면 --upstream 으로 지정한 기본 백엔드로 갑니다.\n# 등록되지 않은 별칭은 400 으로 거절합니다 — 조용히 다른 모델로 새면\n# 벤치마크 결과가 엉뚱한 모델에 붙기 때문입니다.",
  },

  connections: {
    eyebrow: "05 — 프록시 연결",
    title: "어느 toolcall-sre를 보고 있나",
    lead1: "콘솔은 ",
    leadEmph: "항상 서버 사이드로",
    lead2:
      " 프록시를 호출합니다. 그래서 프록시에 CORS 설정이 없어도 되고, 다른 장비에 떠 있는 프록시도 주소만 넣으면 붙습니다. 저장된 API 키는 브라우저로 내려가지 않습니다.",

    status: "연결 상태",
    connectHint:
      "toolcall-sre가 실행 중인지, 아래 주소가 맞는지 확인하세요. 아래 '실행 명령'을 그대로 복사해 쓸 수 있습니다.",
    stateLabel: "상태",
    connected: "연결됨",
    policyLabel: "수리 정책",
    streamingLabel: "스트리밍",
    streamingBoth: "측정 + 수리",
    streamingMeasure: "측정만",
    streamingPass: "통과",
    streamingPassNote: "스트리밍이 관측되지 않습니다",
    adminLabel: "런타임 등록",
    adminOn: "허용",
    adminOff: "잠김",
    adminOnNote: "콘솔에서 백엔드를 추가할 수 있습니다",
    adminOffNote: "--allow-admin 필요",

    registered: "등록된 프록시",
    colName: "이름",
    colUrl: "주소",
    colState: "상태",
    inUseConnected: "사용 중 · 연결됨",
    inUseDisconnected: "사용 중 · 끊김",
    namePlaceholder: "원격 GPU 서버",
    labelOptional: "이름 (선택)",
    urlLabel: "주소",
    testConnection: "연결 테스트",
    duplicate: (label: string) => `이미 등록된 주소입니다 — "${label}" 로 전환했습니다.`,
    probeOk: (policy: string, ms: number) => `연결됨 · 정책 ${policy} · ${ms}ms`,
    probeFail: "연결 실패",
    serverSideNote1: "주소는 ",
    serverSideNoteEmph: "이 콘솔 서버",
    serverSideNote2:
      "(Next 프로세스)에서 본 기준입니다. 브라우저 기준이 아닙니다 — 다른 기기에서 접속 중이더라도, 프록시가 콘솔과 같은 장비에 떠 있다면 ",
    serverSideNote3: " 이 맞습니다.",

    registryTitle: "이 프록시의 백엔드 레지스트리",
    pushModels: "콘솔의 모델 목록 밀어넣기",
    registryNote1: "프록시의 레지스트리는 ",
    registryNoteEmph: "메모리에만",
    registryNote2:
      " 있어서 프로세스가 죽으면 사라집니다. 콘솔이 원본을 파일로 들고 있다가 다시 밀어넣는 구조라, 프록시 재시작이 사건이 되지 않습니다. 같은 별칭을 다시 등록하면 덮어쓰므로 몇 번을 눌러도 안전합니다.",
    registryUnreadable: "레지스트리를 읽을 수 없습니다.",
    colSource: "출처",
    sourceAdmin: "콘솔 등록",
    sourceFlag: "실행 옵션",
    isDefault: "기본",
    synced: (n: number, total: number) => `백엔드 ${n}/${total}개를 이 프록시에 등록했습니다.`,
    syncFailed: (hint: string) => `등록 실패: ${hint}`,

    runCommand: "실행 명령",
    runCommandHint: "콘솔이 기대하는 설정 그대로",
    runCommandBody: `# 콘솔이 이 앱의 목업 백엔드를 쓰도록, 런타임 등록을 허용해서 실행
cargo run --release -- \\
  --listen 127.0.0.1:8091 \\
  --upstream http://127.0.0.1:3100/api/mock/v1 \\
  --repair-policy contextual \\
  --repair-streaming \\
  --allow-admin

# 실제 백엔드를 쓸 때는 --upstream 만 바꾸면 됩니다
#   vLLM   http://127.0.0.1:8000/v1
#   Ollama http://127.0.0.1:11434/v1`,
    adminWarn1: " 은 기본값이 꺼짐입니다. 켜면 요청 목적지를 런타임에 추가할 수 있게 되므로 SSRF 표면이 생기고, 그래서 프록시는 이 옵션이 켜진 채 루프백이 아닌 주소에 바인딩하면 ",
    adminWarnEmph: "기동을 거부합니다",
    adminWarn2: ". 켜기 싫다면 백엔드를 ",
    adminWarn3: " 로 실행 시점에 등록하세요 — 콘솔은 읽기 전용으로 그대로 보여줍니다.",
  },

  policy: {
    OffLabel: "off — 관찰만",
    OffNote: "고치지 않고 기록만 합니다. 모델의 날것 성적을 잴 때.",
    SyntacticOnlyLabel: "syntactic-only — 안전 기본값",
    SyntacticOnlyNote: "값이 있는 형식 오류만 고칩니다. 없는 값은 절대 지어내지 않습니다.",
    ContextualLabel: "contextual",
    ContextualNote:
      "누락된 값도 고치되, 대화 맥락을 실어 보내고 근거가 없으면 거부하게 합니다.",
    FullLabel: "full — 위험",
    FullNote: "맥락 없이 무엇이든 고칩니다. 모델이 값을 지어냅니다. 부작용 없는 도구에만.",
  },

  expect: {
    passthrough: "그대로 통과",
    recovered: "파서가 복구",
    repaired: "수리됨",
    fabricated: "수리됨 · 창작 경고",
    refused: "정책상 거부",
    failed: "수리 실패",
    final: "최종 답변",
  },

  group: {
    normal: "정상",
    syntax: "형식 오류",
    missing: "정보 결손",
    argshape: "인자 형태",
    finish: "응답 종료",
    streaming: "스트리밍",
  },

  scenario: {
    cleanTitle: "정상 툴콜",
    cleanNote: "손대지 않고 그대로 통과해야 합니다. 키 순서까지 보존됩니다.",
    proseTitle: "인사말 + 트레일링 콤마",
    proseNote:
      "관대한 파서만으로 복구됩니다. 모델에 되묻지 않으므로 비용도 지연도 0입니다. 원본 바이트는 클라이언트가 못 읽으므로 반드시 재작성해야 합니다.",
    fencedTitle: "마크다운 코드펜스",
    fencedNote: "펜스를 벗겨내면 정상 JSON입니다.",
    badEnumTitle: "enum 밖의 값",
    badEnumNote:
      '값은 존재하고 의도도 명확합니다("C" = celsius). 지어낼 것이 없으므로 맥락 없이 고쳐도 안전합니다.',
    wrongTypeTitle: "타입 오류 + 필수 누락",
    wrongTypeNote: "location이 숫자입니다. 원본에 도시 이름이 없으므로 고치려면 지어내야 합니다.",
    missingCtxTitle: "필수 항목 누락 — 맥락에 답이 있음",
    missingCtxNote:
      "unit이 없지만 사용자가 celsius라고 말했습니다. 맥락에서 회수하는 것이지 창작이 아닙니다.",
    missingBlindTitle: "필수 항목 누락 — 맥락에도 답이 없음",
    missingBlindNote:
      "이것이 핵심 사례입니다. 어디에도 단위 정보가 없는데 수리는 성공합니다. 창작으로 표시되어야 합니다.",
    garbageCtxTitle: "JSON이 아예 아님 — 맥락에 답이 있음",
    garbageCtxNote:
      "복구할 JSON이 없으니 수리 모델이 전부 채웁니다. 다만 사용자 요청에 도시와 단위가 있으므로 회수이지 창작은 아닙니다.",
    garbageBlindTitle: "JSON이 아예 아님 — 어디에도 답이 없음",
    garbageBlindNote:
      "원본에도 맥락에도 근거가 없는데 수리는 성공합니다. 전부 창작입니다 — 가장 위험한 조합입니다.",
    objectArgsTitle: "arguments가 객체 (Ollama 네이티브)",
    objectArgsNote:
      "패치 전에는 빈 문자열로 읽혀 malformed로 집계되고, 멀쩡한 콜을 수리로 덮어쓸 수 있었습니다.",
    emptyArgsTitle: '인자 없는 도구를 "" 로 호출',
    emptyArgsNote:
      "파라미터가 없는 함수의 정상 관행입니다. 패치 전에는 malformed로 집계되고 헛수리까지 시도했습니다.",
    finalTitle: "정상 최종 답변",
    finalNote: "툴콜 없이 끝난 진짜 완수입니다.",
    truncatedTitle: "토큰 한도로 잘림",
    truncatedNote: "패치 전에는 이것도 '완수'로 집계되어 회복력 지표를 부풀렸습니다.",
    streamCleanTitle: "스트리밍 정상 툴콜",
    streamCleanNote:
      "패치 전에는 스트리밍이면 측정조차 하지 않았습니다. 이제 지연 없이 관찰됩니다.",
    streamProseTitle: "스트리밍 + 인사말 혼입",
    streamProseNote: "델타를 재조립해 복구한 뒤 정상 SSE로 다시 발행합니다.",
    streamMissingTitle: "스트리밍 + 정보 결손",
    streamMissingNote: "스트리밍에서도 창작 탐지가 동일하게 동작해야 합니다.",

    emitsFenced: "```json\\n{...}\\n```",
    emitsObjectArgs: '{"location":"Seoul","unit":"celsius"} (문자열이 아닌 객체)',
    emitsEmptyArgs: '"" (빈 문자열)',
    emitsFinal: '"It is 21 degrees in Seoul." (finish_reason: stop)',
    emitsTruncated: '"It is 21 deg" (finish_reason: length)',
    emitsStreamClean: "조각난 델타로 도착하는 정상 JSON",
    emitsStreamProse: '"Sure! {...,}" 가 7바이트씩 조각나서 도착',
    emitsStreamMissing: '{"location":"Seoul"} 가 조각나서 도착',
  },

  seed: {
    localProxy: "로컬 프록시",
    solidLabel: "모사 · 튼튼한 모델",
    solidNote: "툴콜을 거의 안 틀립니다. 프론티어 API에 가까운 거동.",
    flakyLabel: "모사 · 흔들리는 모델",
    flakyNote: "프로즈 혼입과 필수 항목 누락이 섞입니다. 전형적인 작은 로컬 모델.",
    roughLabel: "모사 · 거친 모델",
    roughNote: "절반 넘게 깨집니다. 툴 파인튜닝이 안 된 소형 모델.",
    scenarioLabel: "모사 · 시나리오 지정",
    scenarioNote: "시험대가 쓰는 백엔드. `model` 필드가 실패 유형을 고릅니다.",
  },
  errors: {
    proxy_unreachable: "프록시에 연결할 수 없습니다",
    proxy_status: "프록시가 오류를 응답했습니다",
    admin_disabled: "프록시가 런타임 등록을 허용하지 않습니다",
    admin_disabled_hint:
      "toolcall-sre를 --allow-admin 으로 실행하거나, --upstream-alias 로 백엔드를 등록하세요.",
    not_toolcall_sre: "응답했지만 toolcall-sre 가 아닌 것 같습니다",
    bad_scheme: "http:// 또는 https:// 로 시작해야 합니다",
    timeout: "응답 없음 (5초 초과)",
    unknown: "알 수 없는 오류",
  },
};

export type Dict = typeof ko;
export default ko;
