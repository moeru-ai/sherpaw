# Speaker identification: compact regression ablation

Run: 2026-09-22T17:56:29.380Z. Chromium 143.0.7499.4, local CPU / single-thread WASM.

Uses eight saved TTS utterances (alloy and nova) plus one upstream natural-speaker negative. Enrollment and query texts are distinct. The JSON contains file/model hashes and every candidate score; original transcripts live only in the fixture manifest.

The threshold remains 0.6 and was not tuned on these queries. This compact regression fixture does not establish human identification accuracy or mobile performance. See the historical six-voice report for harder open-set failures.

## Single-factor comparisons

one-zh uses one Chinese enrollment; two-mixed uses one Chinese and one English enrollment. Query variants keep two-mixed enrollment fixed: first-3-seconds crops without VAD; quiet-0.1 reduces amplitude to one tenth; over-range sets the peak to 1.25 and compares raw input with recording peak adaptation.

| Model / condition | Chinese correct accepts | English correct accepts | Correct top-1 | Input errors | Natural false accepts |
| --- | --- | --- | --- | --- | --- |
| CAM++ / one-zh | 2/2 | 2/2 | 4/4 | 0/4 | 0/1 |
| CAM++ / two-mixed | 2/2 | 2/2 | 4/4 | 0/4 | 0/1 |
| CAM++ / first-3-seconds | 2/2 | 2/2 | 4/4 | 0/4 | — |
| CAM++ / quiet-0.1 | 2/2 | 2/2 | 4/4 | 0/4 | — |
| CAM++ / over-range-raw | 0/2 | 0/2 | 0/4 | 4/4 | — |
| CAM++ / over-range-normalized | 2/2 | 2/2 | 4/4 | 0/4 | — |
| ERes2NetV2 / one-zh | 2/2 | 2/2 | 4/4 | 0/4 | 0/1 |
| ERes2NetV2 / two-mixed | 2/2 | 2/2 | 4/4 | 0/4 | 0/1 |
| ERes2NetV2 / first-3-seconds | 2/2 | 2/2 | 4/4 | 0/4 | — |
| ERes2NetV2 / quiet-0.1 | 2/2 | 2/2 | 4/4 | 0/4 | — |
| ERes2NetV2 / over-range-raw | 0/2 | 0/2 | 0/4 | 4/4 | — |
| ERes2NetV2 / over-range-normalized | 2/2 | 2/2 | 4/4 | 0/4 | — |

## Thresholds and held-out voices

Remove each of the two voices in turn and query its Chinese and English recordings as unknown (four queries total). This is a fixed threshold comparison, not calibration. It does not reproduce the historical six-voice confusion cases.

| Model / threshold | Full-library correct accepts | Held-out voice false accepts | Natural false accepts |
| --- | --- | --- | --- |
| CAM++ / 0 | 4/4 | 4/4 | 1/1 |
| CAM++ / 0.6 | 4/4 | 0/4 | 0/1 |
| CAM++ / 0.75 | 4/4 | 0/4 | 0/1 |
| CAM++ / 0.85 | 3/4 | 0/4 | 0/1 |
| ERes2NetV2 / 0 | 4/4 | 4/4 | 1/1 |
| ERes2NetV2 / 0.6 | 4/4 | 0/4 | 0/1 |
| ERes2NetV2 / 0.75 | 4/4 | 0/4 | 0/1 |
| ERes2NetV2 / 0.85 | 3/4 | 0/4 | 0/1 |

## Reproduction

Run `pnpm -F @sherpaw/testing-audio ablate:speakers` to read fixed local audio without TTS calls. Run `pnpm -F @sherpaw/testing-audio test:speakers` for the compact file and fake-microphone regressions through AudioWorklet / Worker / WASM.
