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
  SherpaOnnxOnlineStreamInputFinished
  SherpaOnnxOnlineStreamIsEndpoint
  SherpaOnnxOnlineStreamReset
)

set(exported_runtime_methods
	ccall
	stringToUTF8
	setValue
	getValue
	lengthBytesUTF8
	UTF8ToString
)

set_emcc_flags(MY_FLAGS "${exported_functions}" "${exported_runtime_methods}")

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${MY_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${MY_FLAGS}")
set(CMAKE_EXECUTABLE_LINKER_FLAGS "${CMAKE_EXECUTABLE_LINKER_FLAGS} ${MY_FLAGS}")

plan_build(asr)