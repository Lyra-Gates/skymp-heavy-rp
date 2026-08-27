# Converte as 5 arrays de tamanho variável (VLA, C99) do rnnoise v0.1.1 em
# alocação por _alloca. O compilador C do MSVC não aceita VLA; clang e gcc sim.
# Mesma semântica (pilha, liberada no retorno da função), sem precisar saber o
# limite superior de cada uma.
#
# Idempotente: depois da troca o padrão antigo não casa mais. Passado como
# PATCH_COMMAND do FetchContent_Declare(rnnoise ...).

set(_src "${RNNOISE_SRC_DIR}")

function(_patch file)
  set(path "${_src}/src/${file}")
  file(READ "${path}" content)
  # garante <malloc.h> para _alloca no MSVC
  if(NOT content MATCHES "#include <malloc.h>")
    set(content "#ifdef _MSC_VER\n#include <malloc.h>\n#endif\n${content}")
  endif()
  string(REPLACE
    "opus_val16 xx[n];"
    "opus_val16 *xx = (opus_val16*)_alloca((n)*sizeof(opus_val16));"
    content "${content}")
  string(REPLACE
    "opus_val16 x_lp4[len>>2];"
    "opus_val16 *x_lp4 = (opus_val16*)_alloca((len>>2)*sizeof(opus_val16));"
    content "${content}")
  string(REPLACE
    "opus_val16 y_lp4[lag>>2];"
    "opus_val16 *y_lp4 = (opus_val16*)_alloca((lag>>2)*sizeof(opus_val16));"
    content "${content}")
  string(REPLACE
    "opus_val32 xcorr[max_pitch>>1];"
    "opus_val32 *xcorr = (opus_val32*)_alloca((max_pitch>>1)*sizeof(opus_val32));"
    content "${content}")
  string(REPLACE
    "opus_val32 yy_lookup[maxperiod+1];"
    "opus_val32 *yy_lookup = (opus_val32*)_alloca((maxperiod+1)*sizeof(opus_val32));"
    content "${content}")
  file(WRITE "${path}" "${content}")
endfunction()

_patch(celt_lpc.c)
_patch(pitch.c)
message(STATUS "rnnoise: VLAs convertidas para _alloca (patch MSVC)")
