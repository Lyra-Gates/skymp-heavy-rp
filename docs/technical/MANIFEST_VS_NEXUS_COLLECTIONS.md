# Por que o manifesto do Launcher não usa o formato de Nexus Collections

## A pergunta

Nexus Collections é um formato JSON popular pra empacotar modlists (usado pelo Vortex e por ferramentas como o Collections Manager pro MO2). Por que não usar o mesmo formato no manifesto do nosso Launcher (`GET /api/launcher/manifest`, `apps/web/server.js`), já que curadores de mod já conhecem essa ferramenta?

## A resposta curta

Resolvem problemas diferentes. Collections descreve **como instalar mods numa máquina single-player**; nosso manifesto garante **que todo jogador tem exatamente os mesmos bytes que o servidor espera**, verificado por hash antes de liberar o login.

## A diferença que importa

| | Nexus Collections | Nosso manifesto |
|---|---|---|
| Público | Um jogador instalando mods na própria máquina | Um servidor multiplayer garantindo paridade entre clientes |
| Unidade | IDs de mod do Nexus + regras de load order (LOOT) | Arquivo + hash + URL de download |
| Verificação | Nenhuma — o Vortex baixa e instala, não confere se o resultado bate com o de outro jogador | Hash SHA-256 obrigatório (ver `apps/launcher/electron/main.ts`, verificação endurecida — hash ausente aborta a instalação) |
| Quem decide a versão | O curador da collection, offline, sem coordenação com um servidor rodando | O nosso `apps/web`, a mesma fonte de verdade que valida whitelist/spawn |
| Load order | Resolvido localmente por LOOT no momento da instalação (pode variar entre máquinas) | Fixo — o servidor não tem como confiar em cada cliente resolvendo load order sozinho |

Um Collection instalado "corretamente" em duas máquinas diferentes pode produzir dois `.esp` com o mesmo conteúdo lógico mas hashes de arquivo diferentes (timestamps, ordem de merge, versão do LOOT) — inaceitável pra um servidor que precisa que `SkyMP.esp` seja **byte-idêntico** em todo cliente conectado (regra de autoridade do servidor, ver `docs/ARCHITECTURE.md` seção 2).

## O que aproveitamos do ecossistema Nexus mesmo assim

- **Curadoria**: nada impede o time de staff usar o Vortex/Collections só como ferramenta de trabalho pra montar e testar a modlist antes de gerar o manifesto final — é um passo manual de conveniência, não uma integração automática.
- **Licenciamento**: a política de licença do projeto (`docs/technical/LICENSE_AND_AFFILIATION_POLICY.md`) já trata "verificar permissão de redistribuição" mod a mod, igual o Nexus exige pra Collections públicas — o processo de compliance é o mesmo, só o formato de saída que é diferente.

## Decisão

Manter o manifesto próprio (`{version, files: [{path, hash, url}]}`). Não migrar pra formato de Collections — o ganho de familiaridade pro curador não compensa perder a garantia de hash exato que é o motivo do manifesto existir.
