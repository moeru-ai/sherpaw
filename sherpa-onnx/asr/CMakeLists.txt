# Original author: Copyright (c) 2024 Xiaomi Corporation, Licensed under the Apache 2.0 License.
# Modified by Makito in 2026

include(../HelperFunctions.cmake)

set(exported_functions
  # Online ASR
  SherpaOnnxCreateOnlineRecognizer
  SherpaOnnxCreateOnlineStream
  SherpaOnnxDecodeOnlineStream
  SherpaOnnxDestroyOnlineRecognizer
  SherpaOnnxDestroyOnlineRecognizerResult
  SherpaOnnxDestroyOnlineStream
  SherpaOnnxDestroyOnlineStreamResultJson
  SherpaOnnxGetOfflineStreamResultAsJson
  SherpaOnnxGetOnlineStreamResult
  SherpaOnnxGetOnlineStreamResultAsJson
  SherpaOnnxIsOnlineStreamReady
  SherpaOnnxOnlineStreamAcceptWaveform
  SherpaOnnxOnlineStreamGetOption
  SherpaOnnxOnlineStreamInputFinished
  SherpaOnnxOnlineStreamIsEndpoint
  SherpaOnnxOnlineStreamReset
  SherpaOnnxOnlineStreamSetOption
  # Offline ASR
  SherpaOnnxAcceptWaveformOffline
  SherpaOnnxCreateOfflineRecognizer
  SherpaOnnxOfflineRecognizerSetConfig
  SherpaOnnxCreateOfflineStream
  SherpaOnnxDecodeMultipleOfflineStreams
  SherpaOnnxDecodeOfflineStream
  SherpaOnnxDestroyOfflineRecognizer
  SherpaOnnxDestroyOfflineRecognizerResult
  SherpaOnnxDestroyOfflineStream
  SherpaOnnxDestroyOfflineStreamResultJson
  SherpaOnnxGetOfflineStreamResult
  SherpaOnnxOfflineStreamGetOption
  SherpaOnnxOfflineStreamSetOption
)

set(exported_runtime_methods
	ccall
	FS_unlink
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

plan_build(asr)
set_target_properties(asr PROPERTIES LINK_FLAGS "${MY_FLAGS}")

option(SHERPAW_ASR_WEBGPU "Build the optional ASR WebGPU backend" OFF)
if(SHERPAW_ASR_WEBGPU)
  add_subdirectory(../asr-runtime "${CMAKE_CURRENT_BINARY_DIR}/webgpu")
endif()
