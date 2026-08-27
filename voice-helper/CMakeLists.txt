cmake_minimum_required(VERSION 3.21)

# Projeto deliberadamente separado do resto do monorepo: o gamemode é JS puro
# carregado direto pelo SkyMP e não tem etapa de build. Amarrar um toolchain C++
# ao `npm test` faria todo contribuidor precisar de MSVC pra rodar teste de
# JavaScript. Este diretório se compila sozinho.
project(voice-helper LANGUAGES CXX C)  # C: rnnoise (FetchContent) é C puro

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(unofficial-miniaudio CONFIG QUIET)
if(NOT unofficial-miniaudio_FOUND)
  # A port do miniaudio no vcpkg ja exportou o alvo com nomes diferentes ao
  # longo do tempo. Sendo header-only, achar o cabecalho basta.
  find_path(MINIAUDIO_INCLUDE_DIR miniaudio.h REQUIRED)
endif()

find_package(ixwebsocket CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)
find_package(Opus CONFIG REQUIRED)

# rnnoise: supressão de ruído.
#
# NÃO vem do vcpkg: a port `rnnoise` é declarada `!windows` (usa autotools e
# falha no MSVC — visto no primeiro build, 07/08/2026). Em vez de forçar com
# `--allow-unsupported`, buscamos o fonte direto na tag v0.1.1 do Xiph, que é a
# última antes de o modelo virar download separado — os pesos da rede vêm em
# `src/rnn_data.c`, no próprio repositório. São ~7 arquivos C sem dependência
# nenhuma; compilamos como lib estática aqui.
include(FetchContent)
FetchContent_Declare(rnnoise
  GIT_REPOSITORY https://github.com/xiph/rnnoise
  GIT_TAG v0.1.1
  GIT_SHALLOW TRUE
  PATCH_COMMAND ${CMAKE_COMMAND}
    -DRNNOISE_SRC_DIR=<SOURCE_DIR>
    -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/patch-rnnoise-msvc.cmake
)
FetchContent_MakeAvailable(rnnoise)

add_library(rnnoise STATIC
  ${rnnoise_SOURCE_DIR}/src/celt_lpc.c
  ${rnnoise_SOURCE_DIR}/src/denoise.c
  ${rnnoise_SOURCE_DIR}/src/kiss_fft.c
  ${rnnoise_SOURCE_DIR}/src/pitch.c
  ${rnnoise_SOURCE_DIR}/src/rnn.c
  ${rnnoise_SOURCE_DIR}/src/rnn_data.c
  ${rnnoise_SOURCE_DIR}/src/rnn_reader.c
)
target_include_directories(rnnoise PUBLIC ${rnnoise_SOURCE_DIR}/include)
target_include_directories(rnnoise PRIVATE ${rnnoise_SOURCE_DIR}/src)
if(MSVC)
  # kiss_fft.c e pitch.c usam M_PI; o MSVC só o expõe com esta macro.
  target_compile_definitions(rnnoise PRIVATE _USE_MATH_DEFINES _CRT_SECURE_NO_WARNINGS)
  target_compile_options(rnnoise PRIVATE /w)  # fonte de terceiros, sem /W4
endif()

add_executable(voice-helper src/main.cpp)

if(unofficial-miniaudio_FOUND)
  target_link_libraries(voice-helper PRIVATE unofficial::miniaudio::miniaudio)
else()
  target_include_directories(voice-helper PRIVATE ${MINIAUDIO_INCLUDE_DIR})
endif()

target_link_libraries(voice-helper PRIVATE
  ixwebsocket::ixwebsocket
  nlohmann_json::nlohmann_json
  Opus::opus
)

target_link_libraries(voice-helper PRIVATE rnnoise)

if(WIN32)
  # WASAPI vem do backend do miniaudio; estas sao as libs de socket e de
  # enumeracao de dispositivo que ele e o ixwebsocket precisam no Windows.
  #
  # bcrypt: o ixwebsocket arrasta mbedtls (TLS), e o entropy_poll do mbedcrypto
  # chama BCryptGenRandom, que mora em bcrypt.lib. Sem ela o link falha com
  # LNK2019 mesmo sem usarmos TLS em lugar nenhum — o objeto entra na lib
  # inteira, nao so o que a gente chama. Descoberto no primeiro build de
  # verdade, 07/08/2026; ver VOICE_NATIVE_HELPER.md §8.3.
  target_link_libraries(voice-helper PRIVATE ws2_32 ole32 winmm bcrypt)
  target_compile_definitions(voice-helper PRIVATE
    WIN32_LEAN_AND_MEAN
    NOMINMAX
    _CRT_SECURE_NO_WARNINGS
  )
endif()

if(MSVC)
  target_compile_options(voice-helper PRIVATE /W4)
else()
  target_compile_options(voice-helper PRIVATE -Wall -Wextra)
endif()
