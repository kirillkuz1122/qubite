cmake_minimum_required(VERSION 3.10)
project(runner LANGUAGES CXX)

set(BINARY_NAME "qubite_vpn")
set(APPLICATION_ID "ru.qubite.vpn")

# Flutter library and tool build rules
cmake_policy(SET CMP0063 NEW)
set(FLUTTER_MANAGED_DIR "${CMAKE_CURRENT_SOURCE_DIR}/flutter")
add_subdirectory(${FLUTTER_MANAGED_DIR})

# Application build
find_package(PkgConfig REQUIRED)
pkg_check_modules(GTK REQUIRED IMPORTED_TARGET gtk+-3.0)

add_executable(${BINARY_NAME}
  "main.cc"
  "my_application.cc"
  "${FLUTTER_MANAGED_DIR}/generated_plugin_registrant.cc"
)

apply_standard_settings(${BINARY_NAME})

target_link_libraries(${BINARY_NAME} PRIVATE flutter)
target_link_libraries(${BINARY_NAME} PRIVATE PkgConfig::GTK)

add_dependencies(${BINARY_NAME} flutter_assemble)

# Generated plugin build rules
include(flutter/generated_plugins.cmake)

# === Install ===
install(TARGETS ${BINARY_NAME} RUNTIME DESTINATION "${CMAKE_INSTALL_PREFIX}/bin")
install(FILES "${FLUTTER_ICU_DATA_FILE}" DESTINATION "${CMAKE_INSTALL_PREFIX}/lib")
install(FILES "${FLUTTER_LIBRARY}" DESTINATION "${CMAKE_INSTALL_PREFIX}/lib")
foreach(bundled_library ${PLUGIN_BUNDLED_LIBRARIES})
  install(FILES "${bundled_library}"
    DESTINATION "${CMAKE_INSTALL_PREFIX}/lib"
    COMPONENT Runtime)
endforeach(bundled_library)
install(DIRECTORY "${PROJECT_BUILD_DIR}/flutter_assets"
  DESTINATION "${CMAKE_INSTALL_PREFIX}/share/${BINARY_NAME}"
  COMPONENT Runtime)

# Install sing-box binary
install(PROGRAMS "${CMAKE_CURRENT_SOURCE_DIR}/../core_build/linux/sing-box"
  DESTINATION "${CMAKE_INSTALL_PREFIX}/lib/${BINARY_NAME}"
  OPTIONAL)
