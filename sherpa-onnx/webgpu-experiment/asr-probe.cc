#include "asr-bridge.h"
#include <emscripten.h>
#include <cstring>
#include <memory>
#include "nlohmann/json.hpp"
#include "sherpa-onnx/csrc/online-recognizer.h"

bool asr_web_enabled = false;
namespace {
std::unique_ptr<sherpa_onnx::OnlineRecognizer> recognizer;
std::unique_ptr<sherpa_onnx::OnlineStream> stream;
Ort::AllocatorWithDefaultOptions allocator;
size_t ElementBytes(int type) { return type == ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64 ? 8 : 4; }
}

// Triggering workflow: Sherpa ForwardEncoder/Decoder -> async ONNX Runtime Web
// callback -> copy tensors back -> resume Sherpa CIF and token decoding.
EM_ASYNC_JS(char *, RunAsrWeb, (const char *model, const char *description), {
  try {
    return await Module.runAsr(UTF8ToString(model), JSON.parse(UTF8ToString(description)));
  } catch (error) {
    Module.asrError = String(error);
    return 0;
  }
});

std::vector<Ort::Value> AsrWebRun(const char *model, const char *const *names,
                                Ort::Value *inputs, size_t count) {
  nlohmann::json descriptors = nlohmann::json::array();
  for (size_t i = 0; i < count; ++i) {
    auto info = inputs[i].GetTensorTypeAndShapeInfo();
    descriptors.push_back({{"name", names[i]}, {"type", info.GetElementType()},
      {"dims", info.GetShape()}, {"count", info.GetElementCount()},
      {"ptr", reinterpret_cast<uintptr_t>(inputs[i].GetTensorRawData())}});
  }
  char *response = RunAsrWeb(model, descriptors.dump().c_str());
  if (!response) {
    // Resume safely through the native session once, then the browser caller
    // rejects the experiment using Module.asrError. This is never a GPU pass.
    return {};
  }
  auto outputs = nlohmann::json::parse(response);
  free(response);
  std::vector<Ort::Value> result;
  for (auto &output : outputs) {
    auto dims = output["dims"].get<std::vector<int64_t>>();
    auto type = static_cast<ONNXTensorElementDataType>(output["type"].get<int>());
    auto tensor = Ort::Value::CreateTensor(allocator, dims.data(), dims.size(), type);
    auto ptr = reinterpret_cast<void *>(output["ptr"].get<uintptr_t>());
    std::memcpy(tensor.GetTensorMutableRawData(), ptr,
                tensor.GetTensorTypeAndShapeInfo().GetElementCount() * ElementBytes(type));
    free(ptr);
    result.push_back(std::move(tensor));
  }
  return result;
}

extern "C" {
void AsrCreate() {
  sherpa_onnx::OnlineRecognizerConfig config;
  config.model_config.paraformer.encoder = "/encoder.onnx";
  config.model_config.paraformer.decoder = "/decoder.onnx";
  config.model_config.tokens = "/tokens.txt";
  config.model_config.provider_config.provider = "cpu";
  config.model_config.num_threads = 1;
  config.model_config.modeling_unit = "cjkchar";
  config.enable_endpoint = false;
  recognizer = std::make_unique<sherpa_onnx::OnlineRecognizer>(config);
}
void AsrStart(int web) {
  asr_web_enabled = web;
  stream = recognizer->CreateStream();
}
void AsrAccept(const float *samples, int count) { stream->AcceptWaveform(16000, samples, count); }
void AsrFinish() { stream->SetOption("is_final", "1"); stream->InputFinished(); }
int AsrReady() { return recognizer->IsReady(stream.get()); }
void AsrDecode() { recognizer->DecodeStream(stream.get()); }
const char *AsrText() {
  static std::string text;
  text = recognizer->GetResult(stream.get()).text;
  return text.c_str();
}
void AsrDestroy() { stream.reset(); recognizer.reset(); }
}
