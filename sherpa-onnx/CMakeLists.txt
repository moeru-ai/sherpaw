if (CMAKE_VERSION VERSION_GREATER_EQUAL "4.0.0")
  set(CMAKE_POLICY_VERSION_MINIMUM 3.5)
endif()

cmake_minimum_required(VERSION 3.13 FATAL_ERROR)

add_subdirectory(upstream)

add_subdirectory(asr)
add_subdirectory(speaker-embedding)
