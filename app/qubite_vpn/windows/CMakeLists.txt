cmake_minimum_required(VERSION 3.14)
project(qubite_vpn LANGUAGES CXX)

set(BINARY_NAME "qubite_vpn")
set(CMAKE_INSTALL_PREFIX "${CMAKE_BINARY_DIR}/runner")

# Configure build settings shared across all targets.
function(apply_standard_settings target)
  target_compile_features(${target} PUBLIC cxx_std_17)
  target_compile_options(${target} PRIVATE /W4 /WX /wd"4100")
  target_compile_options(${target} PRIVATE /EHsc)
  target_compile_definitions(${target} PRIVATE "_HAS_EXCEPTIONS=0")
  target_compile_definitions(${target} PRIVATE "$<$<CONFIG:Debug>:_DEBUG>")
endfunction()

set(PROJECT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/..")

# Flutter library and tool build rules
set(FLUTTER_MANAGED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/flutter")
add_subdirectory(${FLUTTER_MANAGED_DIR})

# Application build
add_subdirectory("runner")

# Generated plugin build rules
include(flutter/generated_plugins.cmake)

# === Install bundle ===
set(BUILD_BUNDLE_DIR "${PROJECT_BINARY_DIR}/runner/$<CONFIG>")
install(CODE "
  file(REMOVE_RECURSE \"${BUILD_BUNDLE_DIR}\")
  " COMPONENT Runtime)

install(TARGETS ${BINARY_NAME} RUNTIME DESTINATION "${BUILD_BUNDLE_DIR}"
  COMPONENT Runtime)

install(FILES "${FLUTTER_ICU_DATA_FILE}" DESTINATION "${BUILD_BUNDLE_DIR}"
  COMPONENT Runtime)

install(FILES "${FLUTTER_LIBRARY}" DESTINATION "${BUILD_BUNDLE_DIR}"
  COMPONENT Runtime)

foreach(bundled_library ${PLUGIN_BUNDLED_LIBRARIES})
  install(FILES "${bundled_library}"
    DESTINATION "${BUILD_BUNDLE_DIR}"
    COMPONENT Runtime)
endforeach(bundled_library)

install(DIRECTORY "${PROJECT_BUILD_DIR}/flutter_assets"
  DESTINATION "${BUILD_BUNDLE_DIR}/data"
  COMPONENT Runtime)

# Copy sing-box binary to bundle
install(FILES "${CMAKE_CURRENT_SOURCE_DIR}/../core_build/windows/sing-box.exe"
  DESTINATION "${BUILD_BUNDLE_DIR}/data"
  COMPONENT Runtime
  OPTIONAL)
