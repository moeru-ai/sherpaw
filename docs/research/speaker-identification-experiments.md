# Historical six-voice and pitch/speed experiments

Recorded on 2026-09-22 and 2026-09-23, before the regression corpus was reduced. Environment: Apple M5 Max, macOS, Chromium 143.0.7499.4, Emscripten 4.0.23, single-thread CPU/WASM inference. This is a functional study, not a mobile-performance or human-identification benchmark.

The historical JSON retains scores and audio hashes. Its English prompt translations describe the original Mandarin inputs; translations were not used to generate those recordings. The maintained [regression corpus](../../packages/testing-audio/cases/speaker-identification/README.md) now contains a smaller, explicitly documented subset. Running current tests does not rerun the historical six-voice study.

## Original protocol

AIHubMix `tts-1` generated six presets: alloy, echo, onyx, nova, shimmer, and fable. Each had two Chinese and one English enrollment utterance, plus distinct Chinese and English query sentences: 30 original mono 16 kHz PCM16 WAVs. All voices used the same texts, and query text was excluded from enrollment. See the [provider documentation](https://docs.aihubmix.com/zh-Hant/api/TTS).

Both models used the same corpus, normalized sums of enrollment embeddings, and a fixed 0.6 threshold. Tests read saved audio; TTS generation was an explicit authoring step. The fake-microphone path was:

```text
saved WAV -> Chromium fake microphone -> getUserMedia -> AudioWorklet
          -> Float32 PCM at the actual context rate -> Worker -> WASM -> scores
```

Microphone capture disabled echo cancellation, noise suppression, and automatic gain control. Each Chinese query captured 12 seconds, including startup and trailing silence. These were fake-microphone tests, not physical microphone measurements.

## Initial open-set failures

The initial native run enrolled only alloy, echo, onyx, and nova, with two Chinese utterances each. Shimmer and fable were unregistered.

| Condition at threshold 0.6 | CAM++ | ERes2NetV2 |
| --- | --- | --- |
| Enrolled Chinese queries | 4/4 correct | 4/4 correct |
| Enrolled English queries | 3/4; nova rejected at 0.5929 | 4/4 correct |
| Unregistered shimmer, Chinese | Incorrectly accepted as alloy, 0.7616 | Incorrectly accepted as alloy, 0.8070 |
| Unregistered fable, Chinese | Incorrectly accepted as echo, 0.7316 | Incorrectly accepted as echo, 0.7599 |
| Unregistered shimmer/fable, English | 2/2 rejected | 2/2 falsely accepted |

Adding English enrollment and registering all six voices tested language coverage and closed-set discrimination. It did not fix these open-set failures. Raising a global threshold can also reject legitimate cross-language queries.

## Complete six-voice browser baseline

Each voice used two Chinese and one English enrollment clips.

| Condition | CAM++ | ERes2NetV2 |
| --- | --- | --- |
| Chinese file queries | 6/6 correct | 6/6 correct |
| English file queries | 6/6 correct | 6/6 correct |
| Chinese fake-microphone queries | 6/6 correct | 6/6 correct |
| Unregistered natural recordings | 3/3 unknown | 3/3 unknown |

Natural negatives used upstream fangjun, leijun, and liudehua files. Their rejection does not supersede the harder synthetic open-set failures above. The last complete fixed-corpus run passed 14 tests and took about 402 seconds.

| Accepted-score range | CAM++ | ERes2NetV2 |
| --- | --- | --- |
| Chinese file | 0.8841-0.9489 | 0.8695-0.9656 |
| English file | 0.7204-0.8528 | 0.8605-0.9371 |
| Chinese fake mic | 0.8641-0.9486 | 0.8753-0.9509 |

## Historical registration and threshold ablation

At threshold 0.6, one Chinese enrollment and three mixed-language enrollments both reached 12/12 for both models. Two Chinese enrollments gave CAM++ 11/12; adding English coverage restored 12/12. This does not establish that one recording is always sufficient or that more recordings always help.

Rotating each of the six voices out of enrollment gave these results:

| Model / threshold | Full-library correct accepts | Held-out voice false accepts | Natural false accepts |
| --- | --- | --- | --- |
| CAM++ / 0 | 12/12 | 12/12 | 3/3 |
| CAM++ / 0.6 | 12/12 | 6/12 | 0/3 |
| CAM++ / 0.75 | 11/12 | 0/12 | 0/3 |
| CAM++ / 0.85 | 7/12 | 0/12 | 0/3 |
| ERes2NetV2 / 0 | 12/12 | 12/12 | 3/3 |
| ERes2NetV2 / 0.6 | 12/12 | 8/12 | 0/3 |
| ERes2NetV2 / 0.75 | 12/12 | 4/12 | 0/3 |
| ERes2NetV2 / 0.85 | 12/12 | 0/12 | 0/3 |

These are retrospective comparisons, not threshold calibration on an independent development set. ERes2NetV2's result at 0.85 is not a general-purpose recommended threshold. The current smaller corpus must not be used to erase these historical failures.

## Pitch and speed

Only query audio changed. Each condition used 12 queries (six voices, two languages) with unchanged enrollment, in the Chromium Worker. FFmpeg 8.1 Rubber Band settings were:

- Tempo 0.75, 1.25, or 1.5, with pitch fixed at 1.
- Pitch ratio `2^(semitones/12)` for -4, -2, +2, and +4 semitones, with tempo fixed at 1.
- A separate formant-preserved condition, compared with the default shifted formants.

The filter receives a numeric pitch ratio. Exact filter strings and query scores remain in the historical JSON. Transformations are research-only; no pitch/speed API or CI requirement was added.

Each cell reports **correct accepts at 0.6 / correct top-1 without a threshold**, out of 12.

| Query transformation | CAM++ | ERes2NetV2 |
| --- | --- | --- |
| Speed 0.75x | 11/12 / 12/12 | 12/12 / 12/12 |
| Speed 1.25x | 11/12 / 12/12 | 12/12 / 12/12 |
| Speed 1.5x | 11/12 / 12/12 | 12/12 / 12/12 |
| -4 semitones, shifted formants | 0/12 / 6/12 | 0/12 / 6/12 |
| -2 semitones, shifted formants | 0/12 / 11/12 | 0/12 / 9/12 |
| +2 semitones, shifted formants | 5/12 / 12/12 | 3/12 / 7/12 |
| +4 semitones, shifted formants | 0/12 / 8/12 | 0/12 / 6/12 |
| -4 semitones, preserved formants | 0/12 / 8/12 | 0/12 / 7/12 |
| -2 semitones, preserved formants | 0/12 / 11/12 | 0/12 / 11/12 |
| +2 semitones, preserved formants | 4/12 / 12/12 | 0/12 / 10/12 |
| +4 semitones, preserved formants | 0/12 / 8/12 | 0/12 / 4/12 |

CAM++'s three speed-condition rejections were nova English queries, with scores 0.582742, 0.556107, and 0.461232. Their top-1 identity remained correct. ERes2NetV2 accepted all 36 speed queries correctly.

Pitch changes were substantially harder. Formant preservation did not restore reliable identification. No wrong identity was accepted at 0.6 in these pitch conditions, but top-1 without a threshold sometimes chose the wrong voice. Lowering the threshold can turn rejection into misidentification.

These results include artifacts from the selected transformation algorithm. They do not measure natural pitch variation or establish behavior for arbitrary voice changers. No phone, noise, far-field, overlapping-speaker, large-library, or real-user benchmark was performed.
