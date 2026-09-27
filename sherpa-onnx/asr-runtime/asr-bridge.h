// Optional model boundary shared by Paraformer and Zipformer. Patched build-local
// sources call this hook; ordinary ASR builds retain the upstream implementation.
#pragma once
#include "onnxruntime_cxx_api.h"
#include <vector>
extern bool asr_web_enabled;
std::vector<Ort::Value> AsrWebRun(const char *model, const char *const *names,
                                Ort::Value *inputs, size_t count);
