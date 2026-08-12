# 07 — DonAthelion/skymp

## Resumo e diferença do upstream

Snapshot `8c7fd96`, branch `monta-engine` (2026-07-27): 3 commits à frente, 23 atrás, 16 arquivos divergentes. O foco é ampliar Skyrim Platform, não fornecer um gamemode RP.

## Código relevante

Alterações em `ObjectReferenceApi`, `CameraApi`, `InputConverter`, `CallNative`, `SkyrimPlatform.cpp/main.cpp` e definitions TypeScript. O commit mais recente expõe alteração nativa de FOV. Potencial: crosshair target, portas/containers, câmera de carry/restraint, interação e protótipos de montaria/carroça.

## Riscos

Autoridade é `HYBRID/INSECURE` se a API cliente decidir resultado. Raycast/crosshair apenas sugere target; servidor valida form permitido, célula, distância e estado. CallNative amplia enormemente a superfície e pode quebrar por versão/ABI. Câmera/Input devem permanecer cosméticos e locais.

## Recomendação

`RESEARCH_MORE`: extrair uma capability de cada vez em branch experimental, com feature flag, versão suportada e teste de crash. `INSPIRE_ONLY` até licença e compatibilidade serem verificadas. Não tornar o projeto dependente permanente deste fork.
