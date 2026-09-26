// Experiment-only model boundary. The generated Paraformer source calls this
// hook; the pinned upstream checkout and all ordinary targets stay unchanged.
#pragma once
#include "onnxruntime_cxx_api.h"
#include <vector>
extern bool asr_web_enabled;
std::vector<Ort::Value> AsrWebRun(const char *model, const char *const *names,
                                Ort::Value *inputs, size_t count);
