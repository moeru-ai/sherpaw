# Iru keyword spotting: recording analysis

Run: 2026-09-26. One supplied 11.75-second recording contains Hey Iru, Hello Iru, and Iru Iru. Its average level is -20.5 dBFS and its peak is -1.6 dBFS. This reproduces the missed detections with audible input; elapsed microphone time alone does not establish that speech reaches the detector.

The recording remains outside the repository. The numbers below describe repeated transformations of **one speaker's recording**, not independent speakers or a general recognition-accuracy benchmark.

## Findings

The original three English-phone entries, `IY1 R UW0` pronunciation, four-path beam, score 1, and threshold 0.25 produce no detections. Native sherpa-onnx and the browser WASM reproduce the failure.

The model represents the supplied 伊噜 pronunciation with `L` more readily than English `R`. Its bilingual vocabulary also permits alternate pinyin paths. The updated preset keeps full-phrase English-phone and pinyin alternatives under the same label; it does not trigger on the greeting or name alone. A 16-path beam retains candidates that the original four-path search discards.

A single successful replay was insufficient evidence. Prepending silence changes the feature-frame alignment and can change the result without changing the spoken words. Increasing the beam or boost does not improve results monotonically: candidates compete during search, and some settings mislabel Iru Iru as Hello Iru.

## Start-position experiment

Prepend 0–620 ms of zero-valued PCM in 20 ms increments. For each of the 32 cases, create a new stream, feed 100 ms chunks, append one second of trailing silence, and reset after each hit. A case passes only when the complete ordered result is exactly Hey Iru, Hello Iru, Iru Iru, without extra detections.

All rows except the original use the five pronunciation entries from the first-recording revision (before the second-recording addition below). The model is the fp32 `sherpa-onnx-kws-zipformer-zh-en-3M-2025-12-20` release.

| Configuration | Beam | Score | Threshold | Exact sequences / 32 |
| --- | ---: | ---: | ---: | ---: |
| Original pronunciation | 4 | 1 | 0.25 | 0 |
| First recording-based revision | 16 | 2 | 0.15 | 16 |
| Smaller beam | 8 | 2 | 0.15 | 14 |
| Larger beam | 32 | 2 | 0.15 | 15 |
| Larger beam | 64 | 2 | 0.15 | 9 |
| Lower boost | 16 | 1.5 | 0.15 | 22 |
| Lower threshold | 16 | 2 | 0.1 | 23 |
| **Selected revision** | **16** | **1.5** | **0.1** | **25** |
| More permissive threshold | 16 | 2 | 0.05 | 26 |

The original, first revision, and selected revision were checked with native sherpa-onnx 1.13.8. Browser replay of all 32 offsets through the real UI, Worker, and packaged WASM confirmed the 16/32 and 25/32 counts. The packaged WASM uses the pinned sherpa-onnx 1.13.7 source at `917bed95c8e5c7c18aa4d69fea42e9ef8ef0a60e`.

The selected revision still fails at 40, 60, 80, 280, 300, 600, and 620 ms. This is an improvement, not a completed reliability fix. Threshold 0.05 recovers only one more original-audio offset; the preset retains 0.1 pending a larger negative corpus.

## Audio perturbations

Repeat the same 32 offsets for each condition below. Noise uses a fixed seed (42), zero-mean Gaussian samples, and 30 dB SNR relative to the whole recording's RMS. Resampling uses FFmpeg before feeding the native detector at the new sample rate.

| Condition | Previous score 2 / threshold 0.15 | Selected score 1.5 / threshold 0.1 |
| --- | ---: | ---: |
| Original 16 kHz audio | 16/32 | 25/32 |
| Gain reduced by 6 dB | 18/32 | 24/32 |
| Gain reduced by 12 dB | 16/32 | 21/32 |
| Added noise at 30 dB SNR | 20/32 | 24/32 |
| Resampled to 44.1 kHz | 16/32 | 25/32 |
| Resampled to 48 kHz | 16/32 | 25/32 |
| **Total transformed cases** | **102/192** | **144/192** |

These perturbation counts are from the native runtime. The original recording is also checked through Chromium's simulated microphone, including the actual AudioWorklet capture and resampling path.

## Negative cases and limits

Both selected and previous settings produced no hits on nine unrelated upstream recordings (`en_0`, `en_1`, and `zh_0` through `zh_6`). Three short segments from the supplied recording—one Iru alone, Hello alone, and the final syllable alone—also produced no hits. Their approximate source ranges were 8.45–9.04 s, 5.10–5.95 s, and 3.70–4.35 s, with one second of leading silence.

A 32-path beam with score 1.5 and threshold 0.1 passed 26/32 original-audio offsets but incorrectly detected Iru Iru on the single-Iru crop. The selected 16-path beam avoids that observed error. Twelve short negative samples do not establish a false-alarm rate for continuous listening.

The remaining problem is acoustic/search sensitivity in this model and pronunciation configuration, reproduced outside the browser. This experiment does not establish how other speakers, accents, microphones, or room noise behave. A dependable wake-word configuration needs held-out recordings and longer negative audio; further tuning on this same clip cannot supply that evidence.

## Regression replay

Prepare the models and build the packages as described in the sandbox README. Supply the local mono PCM16 WAV without adding it to Git:

```sh
SHERPAW_KWS_TEST_RECORDING=/absolute/path/iru.wav pnpm -F @sherpaw/sandbox test:kws
```

The opt-in test expects the three phrases in order. It checks the original file, two previously failing offsets (160 and 480 ms), and the simulated microphone. Without the private input it is skipped. The regular playground suite checks the pronunciation variants against the nine upstream negatives. Library defaults remain unchanged; these score and threshold changes apply only to the Iru playground preset.

## Second recording: repeated Hello Iru

A separate 27.03-second recording from the same speaker contains Hey Iru, Hello Iru, Iru Iru, then four more Hello Iru attempts. Local Whisper transcription in Chinese and English helped locate the utterances; its English output duplicated two phrases, so its raw transcript is not used as an exact detection count. The five Hello regions are approximately 5.5–8.3, 12–14.5, 14.7–16.8, 17–19.5, and 19.7–22 seconds. The recording's average level is -19.0 dBFS, with a 0 dBFS peak. Both recordings and their transcripts remain local.

The previous preset produces only Hey Iru and Iru Iru in this file, with **zero Hello Iru hits**, in both native and browser replay. Keeping the beam, score, threshold, and other entries fixed, adding the full-phrase mixed encoding `HH AH0 L OW1 y ī l ù` recovers three Hello hits, delivered at approximately 7.9, 14.0, and 22.0 seconds. The existing English Hello entry remains available. No greeting-only or name-only entry was added.

Controlled alternatives were less effective: adding `h ā l óu y ī l ù` or changing the English greeting to `HH EH0 L OW1` recovered none; adding the model's observed full-pinyin path `h ǎi l áo y ī l ù` recovered two. With the mixed encoding, score 1, 1.5, or 2 at threshold 0.1, and score 1.5 or 2 at threshold 0.05, all still recovered only three in the unmodified file. This is evidence against fixing the remaining misses simply by lowering the threshold.

The two remaining misses, around 16 and 18 seconds, are detected when their complete phrases are replayed separately. Cropping changes both prior stream state and feature-frame alignment, so it does not isolate which is responsible. Prepending silence to the complete recording also changes the outcome:

| Native replay, 32 start positions | Previous five entries | With mixed Hello entry |
| --- | ---: | ---: |
| First recording, exact three-phrase sequence | 25/32 | 25/32 |
| Second recording, exact seven-phrase sequence | 0/32 | 18/32 |
| Second recording, total Hello detections across the 32 replays | 10 | 132 |
| Unrelated upstream audio and three partial-phrase crops | 0 hits | 0 hits |

The second recording contains five Hello attempts per replay. With the addition, 18 start positions recover all five; the other 14 recover three. Four of those failing positions also produce an extra Hey Iru label. These counts describe this local experiment, not general recall or false-alarm rates. The first recording's 192 audio-perturbation cases above were measured before this addition and were not repeated for it.

The browser regression first failed with only Hey Iru and Iru Iru, then passed after adding the mixed entry. It verifies the five total detections in the unmodified file, all seven with 160 ms of leading silence, and one Hello detection from each of the five isolated phrase regions. It deliberately documents the remaining continuous-replay misses instead of describing the preset as reliable. Run it with the specific local mono PCM16 WAV:

```sh
SHERPAW_KWS_TEST_REPEATED_RECORDING=/absolute/path/repeated-iru.wav pnpm -F @sherpaw/sandbox test:kws
```

Both optional recording variables can be supplied together. The browser tests use the real Worker and packaged WASM; the 32-position comparison uses native sherpa-onnx 1.13.8. No model, library-default, or microphone-processing change is part of this correction.
