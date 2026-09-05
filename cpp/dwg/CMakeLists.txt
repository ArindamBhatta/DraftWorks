cmake_minimum_required (VERSION 3.30)

project (dwg-wasm C)
set (CMAKE_C_STANDARD 11)
set (TARGET dwg-wasm)
set (CMAKE_CONFIGURATION_TYPES Debug;Release)
set (CMAKE_NINJA_FORCE_RESPONSE_FILE 1 CACHE INTERNAL "")

get_filename_component(CPP_ROOT_DIR ${CMAKE_SOURCE_DIR} DIRECTORY)
get_filename_component(SOURCE_ROOT_DIR ${CPP_ROOT_DIR} DIRECTORY)
set(CMAKE_INSTALL_PREFIX "${SOURCE_ROOT_DIR}/packages/wasm/lib")

set(LIBREDWG_DIR "${CPP_ROOT_DIR}/build/libredwg")
if (NOT EXISTS "${LIBREDWG_DIR}/CMakeLists.txt")
    message (FATAL_ERROR "libredwg not found at ${LIBREDWG_DIR}. Run `npm run setup:wasm` first.")
endif()

# Only the decoder and the DXF writer are wanted. Turning off write support
# drops the DWG encoder and the DXF->DWG reader, and turning off JSON drops the
# GeoJSON/JSON writers - none of which this bridge calls, and together they are
# most of the binary. LTO is off because Emscripten reports IPO unsupported.
set (BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set (LIBREDWG_LIBONLY ON CACHE BOOL "" FORCE)
set (LIBREDWG_DISABLE_WRITE ON CACHE BOOL "" FORCE)
set (LIBREDWG_DISABLE_JSON ON CACHE BOOL "" FORCE)
set (DISABLE_WERROR ON CACHE BOOL "" FORCE)
set (ENABLE_LTO OFF CACHE BOOL "" FORCE)

add_subdirectory (${LIBREDWG_DIR} ${CMAKE_CURRENT_BINARY_DIR}/libredwg EXCLUDE_FROM_ALL)

add_executable (${TARGET} src/dwg_wasm.c)

# dwg.h is the public API, but the DXF writer (dwg_write_dxf) and the Bit_Chain
# it writes through are internal, so src/ and the generated src/config.h have to
# be on the path too - the same set dwg2dxf.c itself includes.
target_include_directories (${TARGET} PRIVATE
    ${LIBREDWG_DIR}/include
    ${LIBREDWG_DIR}/src
    ${CMAKE_CURRENT_BINARY_DIR}/libredwg/src
)
target_link_libraries (${TARGET} PRIVATE redwg)

# LibreDWG is C with a lot of legacy formatting warnings that are not ours to
# fix; they are silenced so a real warning in the bridge stays visible.
target_compile_options (${TARGET} PRIVATE -Wall)

# -Oz over -O3: this module is downloaded before a drawing can be opened, so
# bytes on the wire matter more than decode throughput.
#
# ENVIRONMENT excludes node, matching chili-wasm. Including it makes the glue
# `await import("node:module")`, which rspack cannot resolve for a web target
# and fails the build. Node callers pass the binary in as `wasmBinary` instead.
set (EmccFlags
    "-Oz"
    "--no-entry"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=initDwgWasm"
    "-sENVIRONMENT=web,worker"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sSTACK_SIZE=1048576"
    "-sFILESYSTEM=1"
    "-sINVOKE_RUN=0"
    "-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap','HEAPU8','UTF8ToString']"
    "-sEXPORTED_FUNCTIONS=['_dwg_wasm_convert','_dwg_wasm_result','_dwg_wasm_result_size','_dwg_wasm_release','_malloc','_free']"
    "--emit-tsd dwg-wasm.d.ts"
)
string (REPLACE ";" " " EmccFlags "${EmccFlags}")

set_target_properties (${TARGET} PROPERTIES
    OUTPUT_NAME "dwg-wasm"
    SUFFIX ".js"
    LINK_FLAGS "${EmccFlags}"
)

install (FILES
    "${CMAKE_CURRENT_BINARY_DIR}/dwg-wasm.js"
    "${CMAKE_CURRENT_BINARY_DIR}/dwg-wasm.wasm"
    "${CMAKE_CURRENT_BINARY_DIR}/dwg-wasm.d.ts"
    DESTINATION ${CMAKE_INSTALL_PREFIX}
)
