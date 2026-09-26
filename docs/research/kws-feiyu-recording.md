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

## Fourth recording: natural speech versus deliberate articulation

A new 23.79-second recording contains approximately seven 肥鱼肥鱼 attempts, as confirmed by the speaker, who reported only the last, deliberately articulated attempt triggering during live use. Whole-file average level is -25.3 dBFS and peak is -0.7 dBFS. Local automatic transcription produced repetitive hallucinations and was not used as the ground-truth count.

The unchanged preset detects three in file replay, delivered at approximately 6.0, 13.0 and 21.0 seconds, in both native KWS and browser WASM. The user's live observation and this file replay are different inputs; the three-hit file result does not establish that live capture detected the first two. The confirmed seven-utterance target is now an opt-in **failing** browser regression, rather than an assertion that the current three hits are sufficient.

One simulated-microphone replay delivers two hits. Its AudioContext uses 44.1 kHz in this run (earlier experiments used 48 kHz); replaying the captured PCM through native KWS at 44.1 kHz reproduces the same two hits, around 6.0 and 13.0 seconds. This still differs from the user’s live observation and does not reproduce the exact live input.

### Candidate trace

A temporary diagnostic build of the pinned WASM records candidate token paths and native reset times. It is served only to an isolated local test browser, together with its matching Emscripten JS glue. The trace-enabled build reproduces the same three file hits. Neither diagnostic binary nor private audio/transcripts/traces are committed; upstream source and normal build artifacts are restored afterward.

During the second utterance, around 7.4–9.1 seconds:

- A correct `f ēi y ú` prefix exists among the candidates at 7.88 seconds and is still present at 8.08 seconds.
- By 8.12 seconds no retained candidate contains that complete first-name prefix. Competing paths include `n ǐ`, the beginning of 你好肥鱼.
- The second name starts a new `f ... y ú` prefix around 8.4–8.84 seconds. It cannot complete the repeated-name keyword after losing the first half.
- No complete keyword match is reached in this interval, so the final confidence threshold is not what rejects this attempt.
- There is no stream reset between 7.36 and 9.28 seconds. A mid-utterance reset therefore does not explain this particular miss.

This identifies candidate loss during decoding as one concrete failure mechanism. It does not prove that every missed utterance has the same cause, or that the acoustic model's training, rather than search behavior, is solely responsible.

### Controlled comparisons

Keep beam 16 and threshold 0.1 unless specified. Every score experiment uses the existing complete-phrase matches, without adding truncated keywords.

| Change | Fourth recording | Third recording |
| --- | --- | --- |
| Current bilingual model and preset | 3 repeated-name hits | 5 correct full phrases |
| Chinese-only WenetSpeech KWS model, epoch 12 or 99 | 2 repeated-name hits | 5 hits, but misses 你好肥鱼 |
| Add mixed first/second-tone combinations to the repeated name | Same 3 hits | Same 5 hits |
| Listen only for 肥鱼肥鱼 | 4 hits, including the second attempt | Only the second repeated-name attempt detected; other keywords excluded |
| Raise only 肥鱼肥鱼 boost to 1.5 | 4 hits, including the second attempt | Drops one 大肥鱼 hit: 4 total |
| Raise only 肥鱼肥鱼 boost to 2 | 3 hits, loses the last attempt | 5 hits, but a different set of utterances |

Removing competing keywords or increasing the repeated-name boost recovers the traced second attempt. Neither is a demonstrated improvement for the requested complete vocabulary across recordings, so none of these experimental settings replaces the preset. More pronunciation entries alone do not resolve the demonstrated candidate loss.

A further temporary decoder experiment applies keyword context scores **before** the top-k candidate selection, instead of the upstream ordering that adds them afterward. The third recording improves from five to six hits, but the fourth drops from three to two. The first English recording retains its three labels; the second produces seven results including two Iru Iru labels instead of the expected one. The experiment is rejected because it introduces cross-recording regressions, and the original decoder is restored. Moving the boost earlier is not, by itself, a demonstrated fix for the traced failure.

Run the unresolved target explicitly with the fourth local mono PCM16 WAV:

```sh
SHERPAW_KWS_TEST_NATURAL_RECORDING=/absolute/path/natural.wav pnpm -F @sherpaw/sandbox test:kws -t 'seven natural'
```

Before the candidate-retention change below: **FAIL**, expected seven 肥鱼肥鱼 detections, received three. This fixture is optional and stays outside Git; without the environment variable the test is skipped. The earlier passing tests establish specific supported behavior, not general wake-word reliability. No production detector or preset change is made from this fourth-recording investigation.

## Selected candidate-retention change

The Chinese playground preset now uses **32 active paths** instead of 16, with
boost **1.5 for 肥鱼肥鱼**. Its other boosts remain 1 and thresholds remain 0.1.
The Iru preset stays at 16 paths with its existing pronunciation and score
settings. The public API already supports `maxActivePaths`, so this change does
not add a public option or replace the upstream decoder.

| Unmodified file replay | Previous preset | Selected preset |
| --- | ---: | ---: |
| Third recording | 5/8 | 6/8 |
| Fourth recording | 3/7 | 4/7 |

Native and browser replay agree on these results. The third recording gains the
first repeated-name phrase, delivered around 6.9 seconds, while retaining the
previous five detections. The fourth gains the traced second attempt around
9.2 seconds and keeps its previous detections around 6.0, 13.0 and 21.0 seconds.
The remaining repeated-name misses are unresolved.

Increasing only the beam to 32 leaves the third recording at five hits;
combining it with the repeated-name boost yields six. Larger beams are not
monotonically better: 64 paths with boost 1.5 loses a fourth-recording hit, and
128 paths introduces wrong-label detections. A temporary decoder adaptation
that merged equivalent prefixes before pruning reached higher Chinese file
counts, but caused an English microphone regression. Replaying captured PCM
through the original native decoder still detected all three English phrases.
That decoder adaptation is rejected; the original native sources and packaged
WASM remain unchanged.

Preset changes now carry their candidate count to the Worker. When it changes,
the Worker creates a replacement detector using the already loaded model files
and switches only after successful creation. Failed reconstruction preserves
the old detector; model files are not downloaded again. Pause/resume and stream
reset retain the current candidate count. This keeps the larger Chinese search
from changing the English preset's behavior.

The new private regression replays the first 9.5 seconds of the fourth recording,
preserving its leading audio and full Chinese vocabulary, and requires both
initial attempts. The separate seven-hit target still fails with four hits;
it is not reduced to four. Browser checks also retain the existing English
file/microphone regressions, reject nine unrelated upstream recordings under
each preset, and reject the standalone Chinese name and three partial English
phrases. These same-speaker calibration cases do not establish general recall
or a continuous-listening false-alarm rate.

A simulated-microphone run of the fourth recording with the selected preset yields three hits at 44.1 kHz, versus two in the earlier captured run. File replay yields four; this difference still depends on capture alignment and is not a measurement of the user’s actual microphone session.
