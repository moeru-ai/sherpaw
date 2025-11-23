# Original author: Copyright (c) 2024 Xiaomi Corporation, Licensed under the Apache 2.0 License.
# Modified by Makito in 2025

add_subdirectory(upstream)

set(exported_functions
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
set(mangled_exported_functions)

foreach(x IN LISTS exported_functions)
	list(APPEND mangled_exported_functions "_${x}")
endforeach()

list(JOIN mangled_exported_functions "," all_exported_functions)

set(exported_runtime_methods
	ccall
	stringToUTF8
	setValue
	getValue
	lengthBytesUTF8
	UTF8ToString
)
set(quoted_exported_runtime_methods)

foreach(x IN LISTS exported_runtime_methods)
	list(APPEND quoted_exported_runtime_methods "'${x}'")
endforeach()

list(JOIN quoted_exported_runtime_methods "," all_exported_runtime_methods)

include_directories(${CMAKE_SOURCE_DIR})
set(MY_FLAGS " -s FORCE_FILESYSTEM=1 -s INITIAL_MEMORY=512MB -s ALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_ES6=1")
string(APPEND MY_FLAGS " -sSTACK_SIZE=10485760 ") # 10MB
string(APPEND MY_FLAGS " -sEXPORTED_FUNCTIONS=[_malloc,_free,${all_exported_functions}] ")
string(APPEND MY_FLAGS " -sEXPORTED_RUNTIME_METHODS=[${all_exported_runtime_methods}] ")

message(STATUS "MY_FLAGS: ${MY_FLAGS}")

set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${MY_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${MY_FLAGS}")
set(CMAKE_EXECUTABLE_LINKER_FLAGS "${CMAKE_EXECUTABLE_LINKER_FLAGS} ${MY_FLAGS}")

if(NOT CMAKE_EXECUTABLE_SUFFIX STREQUAL ".js")
	message(FATAL_ERROR "The default suffix for building executables should be .js!")
endif()

add_executable(sherpa-onnx-wasm-main sherpa-onnx-wasm-main.cc)
target_link_libraries(sherpa-onnx-wasm-main sherpa-onnx-c-api)
install(TARGETS sherpa-onnx-wasm-main DESTINATION bin/wasm)

install(
	FILES
	"$<TARGET_FILE_DIR:sherpa-onnx-wasm-main>/sherpa-onnx-wasm-main.js"
	"$<TARGET_FILE_DIR:sherpa-onnx-wasm-main>/sherpa-onnx-wasm-main.wasm"
	DESTINATION
	bin/wasm
)
