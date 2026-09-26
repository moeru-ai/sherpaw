include(../HelperFunctions.cmake)
find_program(PATCH_EXECUTABLE patch REQUIRED)

# Apply explicit, zero-fuzz patches to build-local copies. Upstream stays untouched;
# an incompatible source update stops configuration instead of losing a GPU hook.
function(patched_model name output)
  set(source "${CMAKE_CURRENT_SOURCE_DIR}/../upstream/sherpa-onnx/csrc/${name}.cc")
  set(patch "${CMAKE_CURRENT_SOURCE_DIR}/${name}.patch")
  set(target "${CMAKE_CURRENT_BINARY_DIR}/${name}.cc")
  configure_file("${source}" "${target}" COPYONLY)
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${patch}")
  execute_process(COMMAND "${PATCH_EXECUTABLE}" --batch --fuzz=0 "${target}" "${patch}"
    RESULT_VARIABLE result OUTPUT_VARIABLE output_log ERROR_VARIABLE error_log)
  if(NOT result EQUAL 0)
    message(FATAL_ERROR "Cannot apply ${patch}: ${output_log}${error_log}")
  endif()
  set(${output} "${target}" PARENT_SCOPE)
endfunction()

patched_model(online-zipformer2-transducer-model zipformer_source)
patched_model(online-paraformer-model paraformer_source)
get_target_property(core_includes sherpa-onnx-core INCLUDE_DIRECTORIES)

function(asr_runtime target source exports)
  set(runtime UTF8ToString stringToUTF8 lengthBytesUTF8 HEAPU8 HEAPF32 FS ccall)
  set_emcc_flags(flags "${exports}" "${runtime}")
  add_executable(${target} ${source} ../sherpa-onnx-wasm-main.cc)
  target_link_libraries(${target} sherpa-onnx-c-api)
  target_include_directories(${target} PRIVATE ${core_includes} "${CMAKE_CURRENT_SOURCE_DIR}")
  set_target_properties(${target} PROPERTIES LINK_FLAGS "${flags} -sMAXIMUM_MEMORY=4GB")
  set(output "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/sandbox/public/asr-runtime")
  add_custom_command(TARGET ${target} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${output}"
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:${target}>" "${output}/${target}.js"
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:${target}>/${target}.wasm" "${output}/${target}.wasm")
endfunction()

set(catalog_exports CatalogCreate CatalogAccept CatalogFinish CatalogSnapshot CatalogDestroy)
asr_runtime(catalog-asr catalog-asr.cc "${catalog_exports}")
asr_runtime(catalog-asr-webgpu catalog-asr.cc "${catalog_exports}")
set(paraformer_exports AsrCreate AsrStart AsrAccept AsrFinish AsrReady AsrDecode AsrText AsrDestroy)
asr_runtime(paraformer-asr paraformer-asr.cc "${paraformer_exports}")

# Link the model overrides before the static core archive. Keep Asyncify out of
# catalog-asr so ordinary CPU inference retains its synchronous execution path.
target_sources(catalog-asr-webgpu PRIVATE asr-web-run.cc "${zipformer_source}")
target_compile_definitions(catalog-asr-webgpu PRIVATE SHERPAW_ASR_WEBGPU=1)
target_sources(paraformer-asr PRIVATE asr-web-run.cc "${paraformer_source}")
foreach(target catalog-asr-webgpu paraformer-asr)
  set_property(TARGET ${target} APPEND_STRING PROPERTY LINK_FLAGS " -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576")
endforeach()
