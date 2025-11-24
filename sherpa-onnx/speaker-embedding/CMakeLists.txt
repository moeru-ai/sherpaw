# Original author: Copyright (c) 2024 Xiaomi Corporation, Licensed under the Apache 2.0 License.
# Modified by Makito in 2025

include(../HelperFunctions.cmake)

set(exported_functions

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
	SherpaOnnxOnlineStreamReset
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
)

include_directories(${CMAKE_SOURCE_DIR})

set_emcc_flags(MY_FLAGS "${exported_functions}" "${exported_runtime_methods}")

message(STATUS "MY_FLAGS: ${MY_FLAGS}")

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${MY_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${MY_FLAGS}")
set(CMAKE_EXECUTABLE_LINKER_FLAGS "${CMAKE_EXECUTABLE_LINKER_FLAGS} ${MY_FLAGS}")

if(NOT CMAKE_EXECUTABLE_SUFFIX STREQUAL ".js")
	message(FATAL_ERROR "The default suffix for building executables should be .js!")
endif()

plan_build(speaker-embedding)