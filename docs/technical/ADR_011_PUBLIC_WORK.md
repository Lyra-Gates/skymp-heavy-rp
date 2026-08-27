# ADR 011 — Public Work

**Status:** Aceito e implementado em LAB · **Data:** 20/08/2026 ·
**Revisado contra o código:** 26/08/2026 ·
**Depende de:** [ADR 007](ADR_007_WORK_ECOSYSTEM_TAXONOMY.md),
[ADR 002](ADR_002_INTERACTION_FRAMEWORK.md)

## Decisão

Public Work é o piso econômico acessível a qualquer personagem. Ele possui:

- nenhuma profissão ou slot obrigatório;
- nenhum XP de profissão;
- recompensa baixa e previsível;
- cooldown compartilhado obrigatório;
- uma única execução ativa por personagem;
- início, progresso e conclusão validados pelo servidor;
- interação física pelo Interaction Framework, sem comando de chat para o
  jogador.

### Regra de alvo e input

E executa contra a referência exata sob a mira, nunca contra o ator ou objeto
apenas mais próximo. Proximidade apenas valida se o alvo mirado está em alcance;
ela não descobre nem substitui o alvo. O cliente envia o FormID convertido; o
servidor resolve e revalida alvo,
célula, distância, estado e permissão no `query` e novamente no `execute`.

Alvo vazio, alterado ou não registrado falha fechado. Minerador e Public Work
devem consumir um único adaptador de alvo físico do Interaction Framework e um
único listener de E. O adaptador com `Game.getCurrentCrosshairRef()` já foi
implementado em LAB e é compartilhado pelo Minerador e pelo Public Work. O
fluxo continua sujeito a homologação na build usada pelo projeto antes de
qualquer promoção.

### Estado da implementação em 26/08/2026

O serviço genérico, o registry de rotas, a máquina de estados, as interações,
o pagamento transacional, cooldown, sweep, métricas e a migration v29 estão no
repositório. O módulo nasce desligado e o perfil local não fornece rotas reais.
Persistem dois defeitos de hardening no serviço: replay de aceite/coleta pode
confirmar uma run já terminal e eventos de expiração não preenchem diretamente
`character_id`. MariaDB e clientes reais ainda não validaram a implementação.

Qualquer ação com duração usa sessão/relógio autoritativo no servidor. Barra de
progresso ou timer do cliente é apenas apresentação e não conclui trabalho nem
libera recompensa.

### Regra econômica fundamental

**Public Work nunca produz diretamente o recurso econômico primário de uma
profissão.** Ele move, entrega, abastece, limpa ou auxilia.

Exemplos:

- entrega de lenha transporta uma carga vinculada; não corta árvores;
- ajudante de mina leva ferramentas ou caixas; não extrai minério;
- ajudante de fazenda leva fardos ou água; não colhe a produção comercial;
- ajudante de forja entrega combustível; não fabrica equipamentos.

## Modelo

O catálogo é estático em código nesta fase:

```text
PublicWorkDefinition
  code
  label
  origin target
  destination target
  base reward
  time limit
  shared cooldown group
  cargo policy
```

Cada tentativa é persistente:

```text
PublicWorkRun
  id
  character_id
  work_code
  origin_ref
  destination_ref
  status: assigned | in_progress | completed | cancelled | expired
  cargo_token
  request_id
  started_at
  expires_at
  completed_at
```

`cargo_token` identifica a carga específica daquela execução. `request_id`
protege criação e conclusão contra retry e clique duplo. A transação de
pagamento também precisa de chave de idempotência própria.

## Fluxo de interação

```text
quadro/capataz + E
  → listar trabalhos permitidos
  → aceitar

carga/origem + E
  → validar execução atribuída e distância
  → vincular cargo_token
  → status in_progress

destino + E
  → validar personagem, rota, prazo, carga e distância
  → pagar atomicamente
  → status completed
  → iniciar cooldown compartilhado
```

Menus podem escolher um trabalho ou mostrar instruções, mas não substituem a
interação com o alvo físico. Comandos ficam restritos a administração e debug.

## Catálogo inicial aprovado

1. `hay_delivery` — transportar fardo dentro de uma fazenda/cidade.
2. `firewood_delivery` — transportar lenha preparada, sem cortar árvore.
3. `courier_run` — levar correspondência lacrada.
4. `porter` — mover caixa entre depósito e ponto de entrega.
5. `stable_supply` — entregar água, feno ou ferramentas no estábulo.
6. `supply_runner` — levar provisões entre pontos públicos.

`dock_worker`, `farm_helper` e `caravan_helper` ficam candidatos posteriores;
não entram no MVP sem alvo físico e rota validados no mundo.

## Restart, desconexão e abandono

- A execução persiste após desconexão enquanto não expirar.
- No boot, o serviço não paga nem cancela corridas por presunção; uma varredura
  marca como `expired` apenas as que ultrapassaram `expires_at`.
- Cancelamento nunca paga recompensa e invalida a carga.
- Uma carga de execução cancelada, expirada ou concluída não pode ser usada em
  outra corrida.
- Apenas uma corrida em `assigned` ou `in_progress` pode existir por personagem.

## Relação com outros sistemas

- **Profession:** independente; não concede XP nem recurso primário.
- **Resource Nodes:** Public Work não consome nós profissionais no MVP.
- **Contracts:** contratos são publicados por jogadores e usam escrow; Public
  Work é gerado pelo sistema e tem conclusão objetiva.
- **Economy:** pagamento passa pelo Transaction Service e ledger.
- **Inventory:** carga passa pelo Inventory Framework ou por token persistente;
  nunca por item concedido sem rastro.
- **Interaction:** quadro, origem e destino são alvos registrados; o servidor
  revalida distância no `execute`.

## Observabilidade mínima

Registrar, sem depender apenas de log textual:

- criação, coleta, entrega, cancelamento e expiração;
- `character_id`, `run_id`, `work_code`, origem e destino;
- recompensa e chave de idempotência;
- motivo de recusa relevante para segurança;
- contadores de conclusão, abandono, expiração e pagamento por tipo.

## Alternativas rejeitadas

- **Execução somente em memória.** Perde estado em restart e abre duplicação.
- **`setTimeout` como estado de trabalho.** Não prova origem, destino ou carga.
- **Pagamento por comando.** Contorna alvo físico e distância.
- **Nearest-target como autoridade.** Em área cheia pode executar contra outro
  objeto ou jogador que não está sob a mira.
- **Timer client-side como prova.** Pode ser acelerado e não prova permanência,
  alcance, ferramenta ou estado.
- **Public Work de corte/mineração/pesca.** Compete diretamente com profissões.
- **Catálogo editável no banco no MVP.** Adiciona uma superfície administrativa
  antes de haver consumidores reais e rotas validadas.
