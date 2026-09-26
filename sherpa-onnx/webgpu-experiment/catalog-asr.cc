#include <string>
#include <vector>
#include "nlohmann/json.hpp"
#include "sherpa-onnx/c-api/c-api.h"

namespace {
const SherpaOnnxOnlineRecognizer *online = nullptr;
const SherpaOnnxOnlineStream *stream = nullptr;
std::string completed, text, snapshot;
int chunks = 0;

// Triggering workflow: CatalogAccept/CatalogFinish -> ready streaming chunks ->
// Sherpa decoder -> accumulated final and partial transcript.
void DecodeOnline(bool final = false) {
  while (SherpaOnnxIsOnlineStreamReady(online, stream)) {
    SherpaOnnxDecodeOnlineStream(online, stream);
    ++chunks;
  }
  const auto *result = SherpaOnnxGetOnlineStreamResult(online, stream);
  const std::string partial = result ? result->text : "";
  if (result) SherpaOnnxDestroyOnlineRecognizerResult(result);
  text = completed + (completed.empty() || partial.empty() ? "" : " ") + partial;
  if (!final && SherpaOnnxOnlineStreamIsEndpoint(online, stream)) {
    completed = text;
    SherpaOnnxOnlineStreamReset(online, stream);
  }
}
}

extern "C" {
void CatalogDestroy() {
  if (stream) SherpaOnnxDestroyOnlineStream(stream);
  if (online) SherpaOnnxDestroyOnlineRecognizer(online);
  stream = nullptr;
  online = nullptr;
  completed.clear();
  text.clear();
  chunks = 0;
}

// Triggering workflow: model worker load -> JSON file roles -> native Sherpa
// Transducer configuration -> streaming recognizer.
int CatalogCreate(const char *description) {
  CatalogDestroy();
  const auto config = nlohmann::json::parse(description);
  if (config.at("family").get<std::string>() != "transducer") return 0;
  const auto encoder = config.at("encoder").get<std::string>();
  const auto decoder = config.at("decoder").get<std::string>();
  const auto joiner = config.at("joiner").get<std::string>();
  const auto tokens = config.at("tokens").get<std::string>();
  SherpaOnnxOnlineRecognizerConfig c{};
  c.feat_config.sample_rate = 16000;
  c.feat_config.feature_dim = config.at("featureDim").get<int>();
  c.model_config.transducer.encoder = encoder.c_str();
  c.model_config.transducer.decoder = decoder.c_str();
  c.model_config.transducer.joiner = joiner.c_str();
  c.model_config.tokens = tokens.c_str();
  c.model_config.num_threads = 1;
  c.model_config.provider = "cpu";
  c.decoding_method = "greedy_search";
  c.enable_endpoint = 1;
  c.rule1_min_trailing_silence = 2.4;
  c.rule2_min_trailing_silence = 0.8;
  c.rule3_min_utterance_length = 20;
  online = SherpaOnnxCreateOnlineRecognizer(&c);
  if (!online) return 0;
  stream = SherpaOnnxCreateOnlineStream(online);
  return stream != nullptr;
}

// Triggering workflow: microphone PCM RPC -> online stream -> decode partial text.
void CatalogAccept(const float *samples, int count) {
  SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, samples, count);
  DecodeOnline();
}

// Triggering workflow: Stop RPC -> tail padding and input-finished -> final text.
void CatalogFinish() {
  const std::vector<float> tail(16000, 0);
  SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, tail.data(), tail.size());
  SherpaOnnxOnlineStreamInputFinished(stream);
  DecodeOnline(true);
}

const char *CatalogSnapshot() {
  snapshot = nlohmann::json({{"text", text}, {"decodedChunks", chunks}}).dump();
  return snapshot.c_str();
}
}
