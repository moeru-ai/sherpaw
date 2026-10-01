<script setup lang="ts">
import type { SpeakerMap } from '@sherpaw/speaker-diarization'

import type { Projection } from './speaker-map'
import { computed, shallowRef, watch } from 'vue'
import { cosine, principalAxes, project } from './speaker-map'

const props = defineProps<{
  map?: SpeakerMap
  selected?: number
  /** The running tracker's merge threshold, to explain the table. */
  mergeThreshold: number
  colorOf: (speaker: number | null) => string
  nameOf: (speaker: number | null) => string
}>()

const emit = defineEmits<{ select: [index: number] }>()

const size = 300
const padding = 16
/** The last projection: new axes keep its signs, so the picture does not flip between updates. */
const projection = shallowRef<Projection>()

watch(() => props.map, (map) => {
  projection.value = map ? principalAxes(map.units.map(unit => unit.embedding), projection.value) : undefined
}, { immediate: true })

const plot = computed(() => {
  const map = props.map
  const axes = projection.value

  if (!map || !axes)
    return undefined

  const units = map.units.map(unit => ({ ...unit, ...project(unit.embedding, axes) }))
  const speakers = map.speakers.map(speaker => ({ ...speaker, ...project(speaker.embedding, axes) }))
  const all = [...units, ...speakers]
  const minX = Math.min(...all.map(point => point.x))
  const maxX = Math.max(...all.map(point => point.x))
  const minY = Math.min(...all.map(point => point.y))
  const maxY = Math.max(...all.map(point => point.y))
  // One scale for both axes: equal distances look equal.
  const scale = (size - 2 * padding) / Math.max(maxX - minX, maxY - minY, 1e-6)
  const place = (point: { x: number, y: number }) => ({
    cx: padding + (point.x - minX) * scale + (size - 2 * padding - (maxX - minX) * scale) / 2,
    cy: padding + (maxY - point.y) * scale + (size - 2 * padding - (maxY - minY) * scale) / 2,
  })

  return {
    units: units.map(unit => ({ ...unit, ...place(unit), r: 2 + Math.min(4, Math.sqrt(unit.seconds)) })),
    speakers: speakers.map(speaker => ({ ...speaker, ...place(speaker) })),
  }
})

const matrix = computed(() => (props.map?.speakers ?? []).map(row => (props.map?.speakers ?? []).map(column => cosine(row.embedding, column.embedding))))

function cellStyle(value: number, diagonal: boolean) {
  if (diagonal)
    return { background: '#f5f5f5', color: '#a3a3a3' }

  // White at 0 and below, dark red at the merge threshold and above.
  const strength = Math.max(0, Math.min(1, value / Math.max(props.mergeThreshold, 0.01)))

  return { background: `rgba(185, 28, 28, ${(strength * 0.85).toFixed(2)})`, color: strength > 0.55 ? 'white' : '#262626' }
}
</script>

<template>
  <div>
    <p v-if="!plot" text-neutral-500>
      The map appears after a few utterances longer than 1 s.
    </p>
    <div v-else flex="~ col gap-4">
      <figure flex="~ col gap-2" m-0>
        <svg :viewBox="`0 0 ${size} ${size}`" w-full rounded-lg bg-neutral-50 class="border border-neutral-200" role="img" aria-label="Speaker embeddings projected on their first two principal components">
          <circle
            v-for="(unit, i) in plot.units" :key="`u${i}`"
            :cx="unit.cx" :cy="unit.cy" :r="unit.r"
            :style="{ fill: colorOf(unit.speaker), fillOpacity: unit.index === selected ? 1 : 0.55, stroke: unit.index === selected ? '#171717' : 'none', strokeWidth: 1.5 }"
            cursor-pointer
            @click="emit('select', unit.index)"
          >
            <title>#{{ unit.index }} · {{ unit.seconds.toFixed(1) }} s · {{ nameOf(unit.speaker) }}</title>
          </circle>
          <!-- Rings let clicks through to the dots under them. Presentation goes in style: UnoCSS reads attributes such as font-size="10" as utilities. -->
          <g v-for="speaker in plot.speakers" :key="`s${speaker.speaker}`" :style="{ pointerEvents: 'none' }">
            <circle :cx="speaker.cx" :cy="speaker.cy" :r="9" :style="{ fill: 'white', fillOpacity: 0.75, stroke: colorOf(speaker.speaker), strokeWidth: speaker.enrolled ? 4 : 2.5 }" />
            <text :x="speaker.cx" :y="speaker.cy + 3.5" :style="{ fontSize: '10px', fontWeight: 700, textAnchor: 'middle', fill: colorOf(speaker.speaker) }">{{ speaker.speaker + 1 }}</text>
          </g>
        </svg>
        <figcaption text-xs text-neutral-500>
          Each dot is a piece of speech in its speaker's color; numbered rings mark the speakers. Click a dot to select its row in the transcript. The flat picture is approximate; the table has the exact similarity.
        </figcaption>
      </figure>
      <div v-if="map!.speakers.length > 1" flex="~ col gap-2">
        <div overflow-x-auto>
          <table text-xs tabular-nums class="border-collapse">
            <thead>
              <tr>
                <th />
                <th v-for="speaker in map!.speakers" :key="speaker.speaker" px-1.5 py-1 font-semibold :style="{ color: colorOf(speaker.speaker) }">
                  {{ speaker.speaker + 1 }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, i) in map!.speakers" :key="row.speaker">
                <th px-1.5 py-1 text-left font-semibold whitespace-nowrap :style="{ color: colorOf(row.speaker) }">
                  {{ nameOf(row.speaker) }}
                </th>
                <td v-for="(value, j) in matrix[i]" :key="j" px-1.5 py-1 text-center :style="cellStyle(value, i === j)">
                  {{ i === j ? '—' : value.toFixed(2) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p text-xs text-neutral-500>
          Similarity between two speakers, from 0 to 1. At {{ mergeThreshold.toFixed(2) }} or more, the tracker merges them.
        </p>
      </div>
    </div>
  </div>
</template>
