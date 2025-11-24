function(set_emcc_flags flag_output exported_functions exported_runtime_methods)
	set(_exported_functions)

	foreach(x IN LISTS exported_functions)
		list(APPEND _exported_functions "'_${x}'")
	endforeach()

	set(_exported_runtime_methods)

	foreach(x IN LISTS exported_runtime_methods)
		list(APPEND _exported_runtime_methods "'${x}'")
	endforeach()

	list(JOIN _exported_functions "," _exported_functions)
	list(JOIN _exported_runtime_methods "," _exported_runtime_methods)

	set(flags " -s FORCE_FILESYSTEM=1 -s INITIAL_MEMORY=512MB -s ALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_ES6=1")
	string(APPEND flags " -sSTACK_SIZE=10485760 ") # 10MB
	string(APPEND flags " -sEXPORTED_FUNCTIONS=[_malloc,_free,${_exported_functions}] ")
	string(APPEND flags " -sEXPORTED_RUNTIME_METHODS=[${_exported_runtime_methods}] ")
	set(${flag_output} "${flags}" PARENT_SCOPE)
endfunction()

function(plan_build name)
	add_executable(${name} ../sherpa-onnx-wasm-main.cc)
	target_link_libraries(${name} sherpa-onnx-c-api)
	install(TARGETS ${name} DESTINATION bin/wasm/${name})

	install(
		FILES
		"$<TARGET_FILE_DIR:${name}>/${name}.js"
		"$<TARGET_FILE_DIR:${name}>/${name}.wasm"
		DESTINATION
		bin/wasm/${name}
	)
endfunction()