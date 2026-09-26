#include <cstring>

#include "sherpa-onnx/c-api/c-api.h"

// Keep the evolving upstream config layout in C++, not hard-coded WASM offsets.
extern "C" const SherpaOnnxKeywordSpotter *SherpawCreateKeywordSpotter(
    const char *encoder, const char *decoder, const char *joiner,
    const char *tokens, const char *keywords, int32_t max_active_paths) {
  SherpaOnnxKeywordSpotterConfig config{};
  config.feat_config.sample_rate = 16000;
  config.feat_config.feature_dim = 80;
  config.model_config.transducer.encoder = encoder;
  config.model_config.transducer.decoder = decoder;
  config.model_config.transducer.joiner = joiner;
  config.model_config.tokens = tokens;
  config.model_config.num_threads = 1;
  config.model_config.provider = "cpu";
  config.max_active_paths = max_active_paths;
  config.num_trailing_blanks = 1;
  config.keywords_score = 1.0f;
  config.keywords_threshold = 0.25f;
  config.keywords_buf = keywords;
  config.keywords_buf_size = std::strlen(keywords);
  return SherpaOnnxCreateKeywordSpotter(&config);
}

// Read native fields without depending on struct offsets or upstream JSON
// escaping (a model token can itself contain a quotation mark or backslash).
extern "C" const char *SherpawKeywordResultKeyword(const SherpaOnnxKeywordResult *r) {
  return r->keyword;
}
extern "C" int32_t SherpawKeywordResultCount(const SherpaOnnxKeywordResult *r) {
  return r->count;
}
extern "C" const char *SherpawKeywordResultToken(const SherpaOnnxKeywordResult *r,
                                               int32_t index) {
  return r->tokens_arr[index];
}
extern "C" float SherpawKeywordResultTimestamp(const SherpaOnnxKeywordResult *r,
                                              int32_t index) {
  return r->timestamps[index];
}
extern "C" float SherpawKeywordResultStartTime(const SherpaOnnxKeywordResult *r) {
  return r->start_time;
}
