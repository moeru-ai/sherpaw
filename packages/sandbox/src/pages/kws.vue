<script setup lang="ts">
import { useKWSPlayground } from '../features/kws/page'

const { ready, busy, listening, paused, error, message, seconds, activeLabels, drafts, history, preset, keywordPresets, selectPreset, loadModel, applyKeywords, pauseDetection, addKeyword, removeKeyword, listen, stopMicrophone, testFile, clearHistory } = useKWSPlayground()
</script>

<template>
  <main class="kws-page">
    <RouterLink class="back" to="/">
      ← Sandbox
    </RouterLink>
    <header>
      <div>
        <p class="eyebrow">
          SHERPA-ONNX · 本地语音实验
        </p>
        <h1>Keyword spotting</h1>
        <p class="subtitle">
          设定关键词，听见它出现。监听过程中也可以替换整份词表。
        </p>
      </div>
      <span class="badge" :class="{ live: listening }">{{ listening ? '麦克风开启' : '音频仅在本机处理' }}</span>
    </header>

    <section class="model-panel panel" aria-label="模型设置">
      <div>
        <h2>中英关键词模型 <span class="badge">{{ ready ? '已就绪' : '未加载' }}</span></h2>
        <p>Zipformer 3M · 中文 / English · 模型约 14 MB，另需加载语音引擎</p>
      </div>
      <button :disabled="ready || !!busy" @click="loadModel">
        {{ busy === 'load' ? '加载中…' : ready ? '模型已加载' : '加载模型' }}
      </button>
    </section>

    <div class="workspace">
      <section class="panel keywords" aria-labelledby="keywords-heading">
        <div class="panel-heading">
          <h2 id="keywords-heading">
            词表
          </h2>
          <button class="secondary" :disabled="!!busy" @click="addKeyword">
            ＋ 添加关键词
          </button>
        </div>
        <p class="hint">
          Token 需已按模型编码，以空格分隔；不会自动将原文转成拼音或音素。
        </p>
        <div class="presets" aria-label="预设词表">
          <button v-for="option in keywordPresets" :key="option.id" class="secondary" :aria-pressed="preset.id === option.id" :disabled="!!busy" @click="selectPreset(option.id)">
            {{ option.name }}
          </button>
        </div>
        <p class="hint">
          {{ preset.note }} 模型加载后，选择预设立即生效。
        </p>
        <div class="drafts">
          <div v-for="(row, index) in drafts" :key="row.id" class="keyword-row">
            <label>显示名称<input v-model="row.label" :aria-label="`关键词 ${index + 1} 名称`" :disabled="!!busy" placeholder="例如：Hey Iru"></label>
            <label class="tokens">已编码 token<input v-model="row.tokens" :aria-label="`关键词 ${index + 1} tokens`" :disabled="!!busy" spellcheck="false" placeholder="HH EY1 IY1 R UW0"></label>
            <div class="settings">
              <label>增强分数<input v-model="row.score" :aria-label="`关键词 ${index + 1} 分数`" :disabled="!!busy" type="number" min="0" step="any" placeholder="1"></label>
              <label>触发阈值<input v-model="row.threshold" :aria-label="`关键词 ${index + 1} 阈值`" :disabled="!!busy" type="number" min="0" max="1" step="any" placeholder="0.25"></label>
              <button class="remove secondary" :aria-label="`删除关键词 ${index + 1}`" :disabled="!!busy" @click="removeKeyword(row.id)">
                删除
              </button>
            </div>
          </div>
          <p v-if="!drafts.length" class="empty">
            词表为空，应用后将暂停检测。
          </p>
        </div>
        <div class="actions">
          <button :disabled="!ready || !!busy" @click="applyKeywords">
            {{ busy === 'update' ? '更新中…' : '应用词表' }}
          </button>
          <button class="secondary" :disabled="!ready || paused || !!busy" @click="pauseDetection">
            暂停检测
          </button>
        </div>
        <p class="hint">
          修改后点击应用。更新会重置音频状态；校验失败会保留原词表。
        </p>
        <div class="active-words" aria-label="当前生效词表">
          <span class="hint">当前生效</span>
          <span v-for="(label, index) in activeLabels" :key="index" class="word">{{ label }}</span>
          <span v-if="!activeLabels.length" class="hint">{{ ready ? '已暂停' : '等待加载' }}</span>
        </div>
      </section>

      <section class="panel detection" aria-labelledby="detection-heading">
        <div class="panel-heading">
          <h2 id="detection-heading">
            实时检测
          </h2>
          <span class="badge" :class="{ live: listening && !paused }">{{ paused ? '检测暂停' : listening ? '监听中' : '待机' }}</span>
        </div>
        <div class="capture">
          <div class="time">
            {{ seconds.toFixed(1) }}<span>秒</span>
          </div>
          <div class="actions">
            <button v-if="listening" class="stop" @click="stopMicrophone">
              停止监听
            </button>
            <button v-else :disabled="!ready || paused || !!busy" @click="listen">
              开始监听
            </button>
            <label class="file-button" :class="{ disabled: !ready || paused || listening || !!busy }">
              测试音频文件
              <input type="file" accept="audio/*" aria-label="测试音频文件" :disabled="!ready || paused || listening || !!busy" @change="testFile">
            </label>
          </div>
          <p class="hint">
            命中后自动继续监听。文件检测会从头开始，结果保留在下方。
          </p>
        </div>
        <p class="status" role="status">
          {{ message }}
        </p>
        <p v-if="error" class="error" role="alert">
          {{ error }}
        </p>
        <div class="panel-heading history-heading">
          <h2>命中记录 <span class="count">{{ history.length }}</span></h2>
          <button class="secondary" :disabled="!history.length" @click="clearHistory">
            清空记录
          </button>
        </div>
        <div class="history" aria-label="命中记录">
          <article v-for="hit in history" :key="hit.id" class="hit">
            <div class="hit-heading">
              <strong>{{ hit.label }}</strong><time>片段内 {{ (hit.timestamps[0] ?? 0).toFixed(2) }} s</time>
            </div>
            <p class="hint">
              {{ hit.source }}
            </p>
            <details>
              <summary>Token 时间戳</summary>
              <p class="hint">
                上游片段起点：{{ hit.startTime.toFixed(2) }} s
              </p>
              <div class="token-times">
                <span v-for="(token, index) in hit.tokens" :key="index">{{ token }} <small>{{ (hit.timestamps[index] ?? 0).toFixed(2) }} s</small></span>
              </div>
            </details>
          </article>
          <div v-if="!history.length" class="empty">
            <strong>等待第一个关键词</strong><p>试着说出词表中的词，或选择一段音频。</p>
          </div>
        </div>
        <p class="hint">
          保留最近 100 次命中。展示上游片段内时间，命中后可能重新起算，并非原音频的绝对位置。
        </p>
      </section>
    </div>
    <footer>本页使用已验证的中英 KWS 模型 · 日文尚未验证。</footer>
  </main>
</template>

<style scoped>
.kws-page { min-height: 100dvh; background: #f7f8fa; color: #202833; padding: 28px max(24px, calc((100vw - 1280px) / 2)); font: 14px/1.5 system-ui, sans-serif; }
.back { color: #66717f; text-decoration: none; }
header { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin: 32px 0; }
.eyebrow { color: #64748b; font-size: 11px; letter-spacing: .13em; }
h1 { font-size: 34px; font-weight: 700; letter-spacing: -.03em; margin: 6px 0; }
h2 { font-weight: 650; font-size: 16px; }
.subtitle, .model-panel p { color: #64748b; margin-top: 6px; }
.panel { border: 1px solid #e2e6ec; border-radius: 14px; background: white; padding: 24px; }
.model-panel { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 24px; }
.model-panel button { flex-shrink: 0; white-space: nowrap; }
.workspace { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 24px; align-items: start; }
.panel-heading, .hit-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.badge { font-size: 11px; padding: 5px 10px; border-radius: 20px; background: #f0f3f6; color: #617083; white-space: nowrap; font-weight: 500; }
h2 .badge { margin-left: 8px; }
.badge.live { background: #e5f5ed; color: #176745; }
button, .file-button { border-radius: 8px; padding: 9px 14px; font-weight: 550; font-size: 13px; cursor: pointer; background: #26394a; color: white; border: 1px solid transparent; }
button:hover:not(:disabled) { background: #344e65; }
button:disabled, .file-button.disabled { opacity: .45; cursor: not-allowed; }
.secondary, .file-button { background: white; color: #48576a; border-color: #dce2e9; }
.secondary:hover:not(:disabled) { background: #f4f6f8; }
.stop { background: #9b3333; }
.hint { color: #788391; font-size: 12px; margin-top: 12px; }
.drafts { margin: 18px 0; }
.presets { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.presets button[aria-pressed="true"] { color: #27624a; background: #ecf4f1; border-color: #b7d5c5; }
.keyword-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.8fr); gap: 12px; padding: 16px; border: 1px solid #e9edf1; border-radius: 10px; background: #fcfcfd; margin-bottom: 12px; }
label { display: block; color: #6b7684; font-size: 12px; }
input { display: block; border: 1px solid #dce2e9; border-radius: 6px; background: white; color: #273444; width: 100%; padding: 8px 10px; margin-top: 5px; font-size: 13px; }
input:focus, button:focus-visible, .file-button:focus-within { outline: 2px solid #789baa; outline-offset: 2px; }
.tokens { min-width: 0; }
.tokens input { font-family: ui-monospace, monospace; }
.settings { grid-column: 1 / -1; display: flex; gap: 12px; align-items: end; }
.settings label { flex: 1; min-width: 0; }
.remove { padding: 8px 12px; }
.actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.active-words { border-top: 1px solid #edf0f3; margin-top: 20px; padding-top: 18px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.active-words .hint { margin: 0; }
.word { background: #ecf4f1; color: #33634e; padding: 4px 9px; border-radius: 5px; font-size: 12px; }
.capture { padding: 24px 0 18px; }
.time { font-size: 40px; font-variant-numeric: tabular-nums; color: #34475b; margin-bottom: 18px; }
.time span { font-size: 13px; margin-left: 8px; color: #85909d; }
.file-button { position: relative; overflow: hidden; }
.file-button input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }
.status { background: #f5f7fa; border-radius: 7px; padding: 12px; font-size: 12px; color: #5c6b7c; overflow-wrap: anywhere; }
.error { margin-top: 12px; color: #a22d35; background: #fff1f1; padding: 12px; border-radius: 7px; overflow-wrap: anywhere; }
.history-heading { margin: 26px 0 12px; }
.count { color: #8995a3; font-weight: 400; margin-left: 6px; }
.history { max-height: 470px; overflow: auto; }
.hit { border-top: 1px solid #edf0f3; padding: 15px 0; overflow-wrap: anywhere; }
.hit strong { font-weight: 600; color: #27624a; }
.hit time { font-variant-numeric: tabular-nums; font-size: 12px; color: #617083; white-space: nowrap; }
.hit .hint { margin: 4px 0 8px; }
summary { cursor: pointer; color: #69788a; font-size: 12px; }
.token-times { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.token-times span { background: #f5f7f9; padding: 4px 7px; border-radius: 4px; font-family: ui-monospace, monospace; }
.token-times small { color: #8490a0; }
.empty { text-align: center; padding: 45px 12px; color: #9ba5b1; font-size: 12px; }
.empty strong { display: block; font-weight: 500; font-size: 14px; color: #748292; margin-bottom: 8px; }
footer { color: #939ca8; font-size: 12px; margin-top: 26px; padding-bottom: 20px; }
@media (max-width: 850px) { .workspace { grid-template-columns: 1fr; } header { align-items: start; flex-direction: column; } .kws-page { padding: 20px 16px; } .panel { padding: 18px; } }
</style>
