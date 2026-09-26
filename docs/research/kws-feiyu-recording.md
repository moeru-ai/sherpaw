# Chinese preset: recorded 肥鱼 phrases

Run: 2026-09-26. A supplied 24.96-second recording tests 你好肥鱼, 大肥鱼, and 肥鱼肥鱼. The user confirmed that one standalone 肥鱼 was an accidental utterance; it is excluded from the positive targets. Local transcription places that standalone name around 17 seconds. The other eight utterances are treated as full preset phrases, in this order:

1. 肥鱼肥鱼, around 6 seconds
2. 肥鱼肥鱼, around 8 seconds
3. 大肥鱼, around 10 seconds
4. 大肥鱼, around 12 seconds
5. 你好肥鱼, around 13.5 seconds
6. 肥鱼肥鱼, around 15.5 seconds
7. 大肥鱼, around 19 seconds
8. 肥鱼肥鱼, around 20.5 seconds

The recording and local Whisper transcript remain outside the repository. Its average level is -35.0 dBFS and peak is -4.2 dBFS. These results describe one speaker and recording, not general recognition accuracy.

## Reproduction and controlled probes

The original Chinese preset uses the standard second-tone `f éi` spelling, boost 1 and threshold 0.25. Both native and browser replay produce only 你好肥鱼 and the last 大肥鱼, with no 肥鱼肥鱼 detection. The opt-in browser regression fails on this result before the correction.

Greedy decoding with the same bilingual model repeatedly produces first-tone `f ēi` in place of the expected second-tone `f éi`. Preserve the standard spelling and add first-tone alternatives for each **complete phrase**; a standalone 肥鱼 is never a keyword. The alternatives expose acoustic paths the original vocabulary could not match. This does not establish that the speaker pronounced the word incorrectly.

Each initial probe changes one factor from the baseline. Subsequent threshold and beam experiments keep the added first-tone variants fixed:

| Configuration | Correct full phrases in unmodified recording |
| --- | ---: |
| Original preset, boost 1 / threshold 0.25 / beam 16 | 2/8 |
| Original preset, gain increased by 6 dB and clipped to PCM range | 2/8 |
| Original preset, threshold 0.1 | 3/8 |
| Original preset, boost 1.5 | 2/8 |
| Add first-tone variants, retain threshold 0.25 | 4/8 |
| **Add first-tone variants, threshold 0.1, boost 1** | **5/8** |
| Added variants, threshold 0.05 or 0.02, boost 1 | 5/8 |

Increasing boost to 2 with the variants and threshold 0.1 mislabels a 肥鱼肥鱼 attempt as 你好肥鱼. With boost 1 and threshold 0.1, beam 4 produces no hits, beam 8 produces three, and beam 32 produces the same five as beam 16. The selected correction retains boost 1 and beam 16. Gain did not fix this sample, so the low whole-file average alone does not explain its misses.

The selected preset detects the second 肥鱼肥鱼, all three 大肥鱼 attempts and 你好肥鱼. It still misses the repeated-name phrases around 6, 15.5 and 20.5 seconds. This is a partial improvement, not a reliable wake-word configuration.

## Start positions and negative audio

Prepend 0–620 ms of silence in 20 ms increments, feed 100 ms chunks, and append one second of silence. Each replay starts a new stream and resets after every detection. Match both the expected label and its approximate utterance window, allowing for decoder delivery latency.

| Native replay of 32 start positions | Correct phrase detections / 256 opportunities | Exact eight-phrase sequences |
| --- | ---: | ---: |
| Original preset | 46 | 0/32 |
| Added first-tone variants, threshold 0.25 | 121 | 0/32 |
| Added first-tone variants, threshold 0.1 | 137 | 0/32 |

There are no extra or wrong-label detections in these three configurations across these particular replays. None detects all eight phrases at any tested start position. The selected configuration detects between three and five per replay.

All three configurations produce zero hits on nine unrelated upstream recordings (`en_0`, `en_1`, `zh_0` through `zh_6`), the two supplied Iru recordings, and the standalone-name crop (16.6–17.8 seconds) at each of the same 32 start positions. These short negatives do not establish a continuous-listening false-alarm rate.

Native probes use sherpa-onnx 1.13.8 and the fp32 `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20` model. Browser regression uses the packaged WASM built from pinned sherpa-onnx 1.13.7. No model, library-default, or microphone-processing change is part of this correction. The English preset remains unchanged; its two recording regressions continue to run separately.

## Microphone-path check

The unmodified file produces five hits, while repeated simulated-microphone runs produce three or four. Capture the 48 kHz PCM sent from the real AudioWorklet to the Worker and replay those samples through the native detector: one captured run reproduces the same four labels as the browser. The captured stream starts roughly 9–11 ms later than the original file after aligning their waveforms, and has passed through browser resampling. This narrows the discrepancy to input/capture and acoustic sensitivity rather than only UI result handling; it does not isolate alignment from resampling. No microphone implementation change is made on the basis of this single recording.

## Local browser regression

Prepare the models and build the sandbox as described in its README, then supply the specific local mono PCM16 WAV:

```sh
SHERPAW_KWS_TEST_CHINESE_RECORDING=/absolute/path/chinese.wav pnpm -F @sherpaw/sandbox test:kws
```

The test checks the five recovered detections in order through file input, plus rejection of the standalone-name crop. Simulated-microphone capture has a different start alignment: observed runs yield three or four hits rather than the file's five. Its assertion waits for the complete recording, requires at least three detections and permits only ordered subsets of the five file detections, with no extra labels. It does not assert file/microphone parity. It explicitly documents the three remaining misses. Without the private fixture, the test is skipped. The regular browser suite checks both presets against all nine unrelated upstream recordings. The two English recording variables can be supplied alongside the Chinese one.
