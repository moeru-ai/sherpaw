<script setup lang="ts">
import Button from '../components/Button.vue'
import ModelSetupPopover from '../components/ModelSetupPopover.vue'
import SandboxLayout from '../components/SandboxLayout.vue'
import { useKWSPlayground } from '../features/kws/page'

const { ready, busy, listening, paused, error, message, seconds, activeLabels, drafts, history, preset, keywordPresets, selectPreset, loadModel, applyKeywords, pauseDetection, addKeyword, removeKeyword, listen, stopMicrophone, testFile, clearHistory } = useKWSPlayground()
</script>

<template>
  <SandboxLayout title="KWS">
    <template #setup>
      <ModelSetupPopover :ready="ready">
        <div p-4 flex="~ col gap-4" aria-label="模型设置">
          <div text-xl font-bold>
            中英关键词模型
          </div>
          <p text-sm text-neutral-500>
            Zipformer 3M · 中文 / English · 约 14 MB
          </p>
          <Button :disabled="ready || !!busy" self-end @click="loadModel">
            {{ busy === 'load' ? '加载中…' : ready ? '模型已加载' : '加载模型' }}
          </Button>
        </div>
      </ModelSetupPopover>
    </template>

    <main w-full p-6 flex="~ col items-center gap-6 grow-1">
      <section w-full flex="~ col items-center justify-center gap-6 grow-1" class="min-h-[45dvh]">
        <h1 v-if="!listening && !history.length" text-4xl md:text-6xl lg:text-8xl font-semibold text-center>
          Keyword spotting
        </h1>
        <div class="history" w-full flex="~ col items-center gap-6" aria-label="命中记录">
          <article v-for="(hit, index) in history" :key="hit.id" class="hit" text-center>
            <strong :class="index === 0 ? 'text-4xl font-bold' : 'text-3xl op-70'">{{ hit.label }}</strong>
            <p text-xs text-neutral-500 mt-2>
              {{ hit.source }} · 片段内 {{ (hit.timestamps[0] ?? 0).toFixed(2) }} s
            </p>
            <details text-xs text-neutral-500 mt-2>
              <summary cursor-pointer>
                Token 时间戳
              </summary>
              <p>上游片段起点：{{ hit.startTime.toFixed(2) }} s</p>
              <div class="token-times" flex="~ wrap justify-center gap-2" mt-2>
                <span v-for="(token, tokenIndex) in hit.tokens" :key="tokenIndex">{{ token }} {{ (hit.timestamps[tokenIndex] ?? 0).toFixed(2) }} s</span>
              </div>
            </details>
          </article>
        </div>
        <p v-if="listening && !history.length" text-4xl font-semibold text-center>
          等待关键词<span animate-pulse font-normal>|</span>
        </p>
        <div class="active-words" flex="~ wrap justify-center gap-3" text-neutral-500 aria-label="当前生效词表">
          <span v-for="(label, index) in activeLabels" :key="index" class="word">{{ label }}</span>
        </div>
        <p class="time" text-sm text-neutral-500 tabular-nums>
          {{ seconds.toFixed(1) }} 秒 · {{ paused ? '检测暂停' : listening ? '监听中' : '待机' }}
        </p>
        <div flex="~ wrap items-center justify-center gap-3">
          <Button v-if="listening" @click="stopMicrophone">
            停止监听
          </Button>
          <Button v-else :disabled="!ready || paused || !!busy" @click="listen">
            开始监听
          </Button>
          <label rounded-xl px-3 py-1 b="1 neutral-300" cursor-pointer :class="{ 'op-40 cursor-not-allowed': !ready || paused || listening || !!busy }">
            测试音频文件
            <input type="file" hidden accept="audio/*" aria-label="测试音频文件" :disabled="!ready || paused || listening || !!busy" @change="testFile">
          </label>
          <Button v-if="history.length" @click="clearHistory">
            清空记录
          </Button>
        </div>
        <p role="status" text-sm text-neutral-500 text-center>
          {{ message }}
        </p>
        <p v-if="error" role="alert" text-sm text-red-600 text-center>
          {{ error }}
        </p>
      </section>

      <details w-full max-w-3xl b="t neutral-200" pt-4>
        <summary cursor-pointer font-semibold>
          关键词设置
        </summary>
        <div flex="~ col gap-4" py-4>
          <div flex="~ wrap gap-2" aria-label="预设词表">
            <Button v-for="option in keywordPresets" :key="option.id" :aria-pressed="preset.id === option.id" :disabled="!!busy" @click="selectPreset(option.id)">
              {{ option.name }}
            </Button>
          </div>
          <p text-xs text-neutral-500>
            {{ preset.note }} 模型加载后，选择预设立即生效。手动修改后点击应用。
          </p>
          <div v-for="(row, index) in drafts" :key="row.id" class="keyword-row" grid="~ cols-1 md:cols-2 gap-3" b="1 neutral-300" rounded-xl p-3>
            <label text-sm>显示名称<input v-model="row.label" :aria-label="`关键词 ${index + 1} 名称`" :disabled="!!busy" placeholder="例如：Hey Iru" w-full b="1 neutral-300" rounded-lg p-2 mt-1></label>
            <label text-sm min-w-0>已编码 token<textarea v-model="row.tokens" :aria-label="`关键词 ${index + 1} tokens`" :rows="Math.min(4, row.tokens.split('\n').length)" :disabled="!!busy" spellcheck="false" w-full b="1 neutral-300" rounded-lg p-2 mt-1 font-mono text-xs /></label>
            <div md:col-span-2 flex="~ items-end gap-3">
              <label text-sm flex-1 min-w-0>增强分数<input v-model="row.score" :aria-label="`关键词 ${index + 1} 分数`" :disabled="!!busy" type="number" min="0" step="any" placeholder="1" w-full b="1 neutral-300" rounded-lg p-2 mt-1></label>
              <label text-sm flex-1 min-w-0>触发阈值<input v-model="row.threshold" :aria-label="`关键词 ${index + 1} 阈值`" :disabled="!!busy" type="number" min="0" max="1" step="any" placeholder="0.25" w-full b="1 neutral-300" rounded-lg p-2 mt-1></label>
              <Button :aria-label="`删除关键词 ${index + 1}`" :disabled="!!busy" @click="removeKeyword(row.id)">
                删除
              </Button>
            </div>
          </div>
          <p v-if="!drafts.length" text-sm text-neutral-500>
            词表为空，应用后将暂停检测。
          </p>
          <div flex="~ wrap gap-3">
            <Button :disabled="!!busy" @click="addKeyword">
              ＋ 添加关键词
            </Button>
            <Button :disabled="!ready || !!busy" @click="applyKeywords">
              {{ busy === 'update' ? '更新中…' : '应用词表' }}
            </Button>
            <Button :disabled="!ready || paused || !!busy" @click="pauseDetection">
              暂停检测
            </Button>
          </div>
          <p text-xs text-neutral-500>
            Token 以空格分隔，每行一种发音。更新会重置音频状态；校验失败时保留原词表。
          </p>
        </div>
      </details>
      <p text-xs text-neutral-500 text-center>
        音频仅在本机处理 · 保留最近 100 次命中 · 时间戳属于解码片段，并非音频绝对位置
      </p>
    </main>
  </SandboxLayout>
</template>
