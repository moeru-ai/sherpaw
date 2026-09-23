# Original author: Copyright (c) 2024 Xiaomi Corporation, Licensed under the Apache 2.0 License.
# Modified by Makito in 2025

include(../HelperFunctions.cmake)

set(exported_functions
    SherpaOnnxFileExists

	# Speaker Embedding
	SherpaOnnxCreateSpeakerEmbeddingExtractor
	SherpaOnnxDestroySpeakerEmbeddingExtractor
	SherpaOnnxSpeakerEmbeddingExtractorDim
	SherpaOnnxSpeakerEmbeddingExtractorCreateStream
	SherpaOnnxSpeakerEmbeddingExtractorIsReady
	SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding
	SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding

	# Online Stream
	SherpaOnnxOnlineStreamAcceptWaveform
	SherpaOnnxOnlineStreamInputFinished
	SherpaOnnxDestroyOnlineStream

	# Embedding Manager
	SherpaOnnxCreateSpeakerEmbeddingManager
	SherpaOnnxDestroySpeakerEmbeddingManager
	SherpaOnnxSpeakerEmbeddingManagerAdd
	SherpaOnnxSpeakerEmbeddingManagerAddList
	SherpaOnnxSpeakerEmbeddingManagerAddListFlattened
	SherpaOnnxSpeakerEmbeddingManagerRemove
	SherpaOnnxSpeakerEmbeddingManagerSearch
	SherpaOnnxSpeakerEmbeddingManagerFreeSearch
	SherpaOnnxSpeakerEmbeddingManagerGetBestMatches
	SherpaOnnxSpeakerEmbeddingManagerFreeBestMatches
	SherpaOnnxSpeakerEmbeddingManagerVerify
	SherpaOnnxSpeakerEmbeddingManagerContains
	SherpaOnnxSpeakerEmbeddingManagerNumSpeakers
	SherpaOnnxSpeakerEmbeddingManagerGetAllSpeakers
	SherpaOnnxSpeakerEmbeddingManagerFreeAllSpeakers
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

add_executable(speaker-embedding ../sherpa-onnx-wasm-main.cc)
target_link_libraries(speaker-embedding sherpa-onnx-c-api)
install(TARGETS speaker-embedding DESTINATION bin/wasm/speaker-embedding)
install(
  FILES
  "$<TARGET_FILE_DIR:speaker-embedding>/speaker-embedding.js"
  "$<TARGET_FILE_DIR:speaker-embedding>/speaker-embedding.wasm"
  DESTINATION "${PROJECT_SOURCE_DIR}/../packages/speaker-identification/src/prebuilt"
)
