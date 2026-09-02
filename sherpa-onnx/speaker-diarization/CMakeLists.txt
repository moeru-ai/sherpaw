# Original author: Copyright (c) 2024 Xiaomi Corporation, Licensed under the Apache 2.0 License.
# Modified by Makito in 2026

include(../HelperFunctions.cmake)

set(exported_functions
  SherpaOnnxCreateOfflineSpeakerDiarization
  SherpaOnnxDestroyOfflineSpeakerDiarization
  SherpaOnnxOfflineSpeakerDiarizationDestroyResult
  SherpaOnnxOfflineSpeakerDiarizationDestroySegment
  SherpaOnnxOfflineSpeakerDiarizationGetSampleRate
  SherpaOnnxOfflineSpeakerDiarizationProcess
  SherpaOnnxOfflineSpeakerDiarizationProcessWithCallback
  SherpaOnnxOfflineSpeakerDiarizationResultGetNumSegments
  SherpaOnnxOfflineSpeakerDiarizationResultSortByStartTime
  SherpaOnnxOfflineSpeakerDiarizationSetConfig
)

set(exported_runtime_methods
  ccall
  stringToUTF8
  setValue
  getValue
  lengthBytesUTF8
  UTF8ToString
  HEAPU8
  HEAP16
  HEAP32
  HEAPU32
  HEAPF32
  HEAPF64
)

set_emcc_flags(MY_FLAGS "${exported_functions}" "${exported_runtime_methods}")

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${MY_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${MY_FLAGS}")
set(CMAKE_EXECUTABLE_LINKER_FLAGS "${CMAKE_EXECUTABLE_LINKER_FLAGS} ${MY_FLAGS}")

set(target sherpa-onnx-wasm-main-speaker-diarization)
add_executable(${target} ../sherpa-onnx-wasm-main.cc)
target_link_libraries(${target} sherpa-onnx-c-api)

install(
  FILES
  "$<TARGET_FILE_DIR:${target}>/${target}.js"
  "$<TARGET_FILE_DIR:${target}>/${target}.wasm"
  DESTINATION
  "${PROJECT_SOURCE_DIR}/../packages/speaker-diarization/src"
)
