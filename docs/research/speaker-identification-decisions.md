# Speaker identification implementation decisions

Public APIs remain `createExtractor` and `createInMemoryDB`. The application owns persistence, recording policy, and threshold calibration. Evidence comes from browser regressions, the [current compact ablation](speaker-identification-ablation.md), and the [historical six-voice experiments](speaker-identification-experiments.md).

| Item | Decision | Reason and limits |
| --- | --- | --- |
| Recording peak adaptation | Keep in the recording adapter | Legitimate Web Audio floats can exceed full scale. Scale the entire recording down only when needed; preserve ordinary levels and reject NaN/Infinity. The public extractor still requires normalized PCM. |
| Input validation, independent streams, copied embeddings, native cleanup | Keep | These protect correctness and ownership. Success on clean audio cannot demonstrate that they are unnecessary. Browser tests cover invalid inputs, independent instances, copies, and disposal. |
| Worker and serialized inference queue | Keep | Native inference is synchronous. UI tests verify that a new recording can start while a previous row is processing. |
| Original sample embeddings and stable IDs | Keep | Sample deletion requires rebuilding the centroid from the remaining original vectors. A previously normalized centroid is insufficient to reconstruct them. |
| Multiple enrollment samples | Keep as an option | Historical results show that more recordings do not always help. Language coverage and sample quality matter; do not require a fixed count. |
| Model selection | CAM++ default, ERes2NetV2 optional | The smaller model reduces download size. The larger model does not automatically solve unknown-speaker rejection. Target-device memory and energy remain unmeasured. Model preparation and pinned Hugging Face assets were merged separately. |
| Similarity threshold | Caller-calibrated | In the historical six-voice leave-one-out test, 0.6 falsely accepted 6/12 queries for CAM++ and 8/12 for ERes2NetV2. A higher threshold can reject legitimate speakers. |
| Recording duration | Keep manual control | Three-second excerpts worked in the historical corpus, but arbitrary recordings may begin with silence. Do not add automatic cropping from this evidence. |
| Quiet-audio amplification | Do not add | The historical 0.1-amplitude condition remained identifiable. Peak adaptation only attenuates out-of-range inputs. |
| Pitch/speed transformations | Research only | The experiment does not justify adding a production transform API or a CI dependency. |
| Regression corpus | Reduce to nine fixed WAVs | Two enrolled voices, each with Chinese/English enrollment and held-out queries, plus one natural unknown. This covers competing identities, language changes, multi-sample enrollment, and rejection without retaining the entire research corpus. |
| TTS generation | Explicit maintenance script only | Tests validate saved files and hashes. Missing or changed files fail; CI and the demo never regenerate speech. |
| Test API and timed recording | Test harness only | The interactive demo loads only its UI and inference path. |
| Repeated search and mixed responsibilities | Remove duplication | One ranked search provides both the accepted result and displayed candidates. RPC, sample management, capture, and rendering have separate modules. |

The smaller corpus is a regression fixture, not an accuracy benchmark. Historical unknown-speaker failures remain documented even when the corresponding audio is no longer part of routine CI. Prompt translations in research metadata are explicitly labeled; exact Mandarin transcripts remain with the retained audio fixtures.

Validation commands are documented in the package READMEs. The library has nine browser tests, the demo has four interaction tests, and the compact fixed corpus has six cases across the two models. Model preparation and published assets are already in `main`; this feature uses their pinned Hugging Face submodules.
