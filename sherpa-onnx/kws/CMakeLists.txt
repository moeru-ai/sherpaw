include(../HelperFunctions.cmake)

set(exported_functions
  SherpawCreateKeywordSpotter
  SherpaOnnxDestroyKeywordSpotter
  SherpaOnnxCreateKeywordStream
  SherpaOnnxDestroyOnlineStream
  SherpaOnnxOnlineStreamAcceptWaveform
  SherpaOnnxIsKeywordStreamReady
  SherpaOnnxDecodeKeywordStream
  SherpaOnnxResetKeywordStream
  SherpaOnnxGetKeywordResult
  SherpaOnnxDestroyKeywordResult
  SherpawKeywordResultKeyword
  SherpawKeywordResultCount
  SherpawKeywordResultToken
  SherpawKeywordResultTimestamp
  SherpawKeywordResultStartTime
)
set(exported_runtime_methods
  FS FS_createDataFile addRunDependency removeRunDependency
  stringToUTF8 lengthBytesUTF8 UTF8ToString HEAPU8 HEAPF32
)
set_emcc_flags(MY_FLAGS "${exported_functions}" "${exported_runtime_methods}")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${MY_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${MY_FLAGS}")
set(CMAKE_EXECUTABLE_LINKER_FLAGS "${CMAKE_EXECUTABLE_LINKER_FLAGS} ${MY_FLAGS}")
plan_build(kws)
target_sources(kws PRIVATE kws.cc)
