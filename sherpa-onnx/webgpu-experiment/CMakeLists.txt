include(../HelperFunctions.cmake)

# General model comparison runtime, running in a dedicated browser Worker.
# Override only the streaming Zipformer2 encoder boundary for the optional GPU backend.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../upstream/sherpa-onnx/csrc/online-zipformer2-transducer-model.cc" ZIP_SOURCE)
set(ZIP_HOOK "auto encoder_out = encoder_sess_->Run(")
string(FIND "${ZIP_SOURCE}" "${ZIP_HOOK}" ZIP_HOOK_POSITION)
if(ZIP_HOOK_POSITION EQUAL -1)
  message(FATAL_ERROR "Pinned Zipformer2 encoder hook no longer matches")
endif()
string(REPLACE "${ZIP_HOOK}" "auto encoder_out = asr_web_enabled ? AsrWebRun(\"encoder\", encoder_input_names_ptr_.data(), encoder_inputs.data(), encoder_inputs.size()) : std::vector<Ort::Value>{};\n  if (encoder_out.empty()) encoder_out = encoder_sess_->Run(" ZIP_SOURCE "${ZIP_SOURCE}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/online-zipformer2-web.cc" "#include \"asr-bridge.h\"\n${ZIP_SOURCE}")
set(catalog_exports CatalogCreate CatalogAccept CatalogFinish CatalogSnapshot CatalogDestroy)
set(catalog_runtime UTF8ToString stringToUTF8 lengthBytesUTF8 HEAPU8 HEAPF32 FS ccall)
set_emcc_flags(CATALOG_FLAGS "${catalog_exports}" "${catalog_runtime}")
get_target_property(CATALOG_INCLUDES sherpa-onnx-core INCLUDE_DIRECTORIES)
set(CATALOG_OUTPUT "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/sandbox/public/asr-runtime")
foreach(target catalog-asr catalog-asr-webgpu)
  add_executable(${target} catalog-asr.cc ../sherpa-onnx-wasm-main.cc)
  target_link_libraries(${target} sherpa-onnx-c-api)
  target_include_directories(${target} PRIVATE ${CATALOG_INCLUDES} "${CMAKE_CURRENT_SOURCE_DIR}")
  set_target_properties(${target} PROPERTIES LINK_FLAGS "${CATALOG_FLAGS} -sMAXIMUM_MEMORY=4GB")
  add_custom_command(TARGET ${target} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "${CATALOG_OUTPUT}"
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:${target}>" "${CATALOG_OUTPUT}/${target}.js"
    COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:${target}>/${target}.wasm" "${CATALOG_OUTPUT}/${target}.wasm")
endforeach()
# Keep Asyncify instrumentation out of the ordinary CPU runtime.
target_sources(catalog-asr-webgpu PRIVATE asr-web-run.cc "${CMAKE_CURRENT_BINARY_DIR}/online-zipformer2-web.cc")
target_compile_definitions(catalog-asr-webgpu PRIVATE SHERPAW_ASR_WEBGPU=1)
set_property(TARGET catalog-asr-webgpu APPEND_STRING PROPERTY LINK_FLAGS " -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576")
# Compile a target-local override of two session calls. Linking this object
# before the static core archive preserves Sherpa's frontend and decoder while
# allowing awaitable browser inference, without editing the upstream submodule.
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../upstream/sherpa-onnx/csrc/online-paraformer-model.cc" PARA_SOURCE)
foreach(kind encoder decoder)
  string(FIND "${PARA_SOURCE}" "return ${kind}_sess_->Run(" HOOK_POSITION)
  if(HOOK_POSITION EQUAL -1)
    message(FATAL_ERROR "Pinned Paraformer ${kind} hook no longer matches")
  endif()
endforeach()
string(REPLACE "return encoder_sess_->Run(" "if (asr_web_enabled) { auto out = AsrWebRun(\"encoder\", encoder_input_names_ptr_.data(), inputs.data(), inputs.size()); if (!out.empty()) return out; }\n    return encoder_sess_->Run(" PARA_SOURCE "${PARA_SOURCE}")
string(REPLACE "return decoder_sess_->Run(" "if (asr_web_enabled) { auto out = AsrWebRun(\"decoder\", decoder_input_names_ptr_.data(), decoder_inputs.data(), decoder_inputs.size()); if (!out.empty()) return out; }\n    return decoder_sess_->Run(" PARA_SOURCE "${PARA_SOURCE}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/online-paraformer-web.cc" "#include \"asr-bridge.h\"\n${PARA_SOURCE}")
set(asr_exports AsrCreate AsrStart AsrAccept AsrFinish AsrReady AsrDecode AsrText AsrDestroy)
set(asr_runtime UTF8ToString stringToUTF8 lengthBytesUTF8 HEAPU8 HEAPF32 FS ccall)
set_emcc_flags(ASR_FLAGS "${asr_exports}" "${asr_runtime}")
add_executable(asr-probe asr-probe.cc asr-web-run.cc "${CMAKE_CURRENT_BINARY_DIR}/online-paraformer-web.cc" ../sherpa-onnx-wasm-main.cc)
target_link_libraries(asr-probe sherpa-onnx-c-api)
target_include_directories(asr-probe PRIVATE ${CATALOG_INCLUDES} "${CMAKE_CURRENT_SOURCE_DIR}")
set_target_properties(asr-probe PROPERTIES LINK_FLAGS "${ASR_FLAGS} -sASYNCIFY -sASYNCIFY_STACK_SIZE=1048576")
set(PROBE_OUTPUT "${CMAKE_CURRENT_SOURCE_DIR}/../../packages/sandbox/public/webgpu-experiment")
add_custom_command(TARGET asr-probe POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${PROBE_OUTPUT}"
  COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:asr-probe>" "${PROBE_OUTPUT}/asr-probe.js"
  COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE_DIR:asr-probe>/asr-probe.wasm" "${PROBE_OUTPUT}/asr-probe.wasm")
