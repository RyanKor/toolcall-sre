// 녹화 전 준비 — 실제 오픈소스 모델로 비교 데이터를 미리 채운다.
//
// 실제 모델 호출은 한 건에 수 초~수십 초가 걸려 녹화 중에 돌리면 화면이 멈춘 것처럼 보인다.
// 그래서 측정은 녹화 전에 끝내 두고, 영상에서는 그 결과표를 보여준다.
//
// 실행: node demo/prepare.mjs [회차]     (기본 6회)

const PROXY = process.env.TCS_PROXY ?? 'http://127.0.0.1:8091';
const N = Number(process.argv[2] ?? 6);

const TOOLS = [{
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Current weather',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' },
        unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
      },
      required: ['location', 'unit'],
      additionalProperties: false,
    },
  },
}];

// 단위가 문맥에 없다. 이 과제라야 '지어냄'이 드러난다.
const TASK = 'Tell me the temperature in Seoul';

const OLLAMA = 'http://127.0.0.1:11434/v1';
const VLLM   = process.env.TCS_VLLM ?? 'http://127.0.0.1:8000/v1';

// runs: 이 백엔드만 회차를 달리 준다. 추론 모델은 한 건에 1분이 넘어 회차를 줄인다.
const BACKENDS = [
  { alias: 'ollama-fgemma',  model: 'functiongemma:270m', url: OLLAMA, label: 'Ollama · FunctionGemma 270M' },
  { alias: 'ollama-llama32', model: 'llama3.2:latest',    url: OLLAMA, label: 'Ollama · Llama 3.2 3B' },
  { alias: 'ollama-llama31', model: 'llama3.1:8b',        url: OLLAMA, label: 'Ollama · Llama 3.1 8B' },
  { alias: 'ollama-gptoss',  model: 'gpt-oss:20b',        url: OLLAMA, label: 'Ollama · gpt-oss 20B' },
  { alias: 'vllm-qwen38',    model: 'qwen3.8-27b',        url: VLLM,   label: 'vLLM · Qwen3.8-27B (로컬 서빙)' },
  { alias: 'ollama-qwq',     model: 'qwq:32b',            url: OLLAMA, label: 'Ollama · QwQ 32B', runs: 3 },
];

for (const b of BACKENDS) {
  await fetch(`${PROXY}/admin/upstreams`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      alias: b.alias, base_url: b.url, label: b.label, default_model: b.model,
    }),
  }).catch(() => {});
}

for (const { alias, model, runs } of BACKENDS) {
  const n = runs ?? N;
  const t0 = Date.now();
  let ok = 0;
  for (let i = 0; i < n; i++) {
    try {
      const r = await fetch(`${PROXY}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-tcs-upstream': alias,
          'x-session-id': `demo-${alias}-${i}`,
        },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: TASK }], tools: TOOLS }),
        signal: AbortSignal.timeout(180000),
      });
      if (r.ok) ok++;
      await r.text();
    } catch { /* 개별 실패는 그대로 측정값에 반영된다 */ }
  }
  console.log(`  ${model.padEnd(22)} ${ok}/${n} · ${Math.round((Date.now() - t0) / 1000)}s`);
}

const models = await (await fetch(`${PROXY}/models`)).json();
console.log('\n측정 결과');
const aliases = new Set(BACKENDS.map((b) => b.alias));
for (const m of models.models.filter((x) => aliases.has(x.upstream))) {
  const pct = (v) => (v == null ? '측정전' : `${(v * 100).toFixed(1)}%`);
  console.log(`  ${m.model.padEnd(22)} 정상률 ${pct(m.well_formed_rate).padStart(7)} · 창작 ${m.fabricated}건`);
}
