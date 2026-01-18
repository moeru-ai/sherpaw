#include <stdio.h>

#include <algorithm>
#include <memory>

#include "sherpa-onnx/c-api/c-api.h"

extern "C" {
  void CopyHeap(const char *src, int32_t num_bytes, char *dst) {
    std::copy(src, src + num_bytes, dst);
  }
}