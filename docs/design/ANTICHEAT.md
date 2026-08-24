# Anti-cheat — análise do conselho

**Proposta:** adotar um detector de trainers no launcher, no modelo do que roda hoje num servidor RP brasileiro (varre processos, aplicativos instalados e arquivos, casa contra assinaturas de nome, reporta ao servidor).

**Estado: SCANNER DE CLIENTE REJEITADO. ALTERNATIVA APROVADA EM CONCEITO.**

Análise conforme [`CONSTITUICAO.md`](../CONSTITUICAO.md) §15. O [`HEAVY_RP_GAP_ANALYSIS.md`](../research/HEAVY_RP_GAP_ANALYSIS.md) já classifica anti-cheat como `PARTIAL` e nomeia a falta como **threat model e telemetria** — não como ausência de scanner. Esta análise concorda com aquele diagnóstico e o detalha.

---

## Veredito primeiro

O scanner detecta **que a ferramenta está instalada**. O que nos machuca é **a manipulação acontecendo**. São afirmações diferentes, e confundi-las custa privacidade sem comprar segurança.

Três razões, em ordem de peso:

1. **Ele não detecta a única ameaça que nos atinge de verdade.** Ver §2 — economia e itens já são server-authoritative; o que resta é ActorValue, e nome de processo não diz nada sobre ActorValue.
2. **Custo de contorno: renomear um arquivo.** Custo de falso positivo: acusar um jogador inocente. A assimetria está invertida.
3. **É dado pessoal de brasileiro, num repositório público sob AGPL.** Ver §10 e §13.

O que **fazemos** em vez disso: o servidor observa o efeito, não a ferramenta. §14.

---

## 1. Objetivo

Impedir que alguém obtenha, por manipulação do cliente, vantagem que o servidor aceite como verdadeira — e dar à staff como julgar quando acontecer.

## 2. Problema que resolve — e o tamanho real dele

Aqui está a parte que reorganiza a discussão. **A maior parte do que um trainer faz não nos atinge**, porque a arquitetura já assume cliente hostil (`CONTRIBUTING.md` §3.6):

| O que o trainer faz | Nos atinge? | Por quê |
|---|---|---|
| Ouro infinito | **Não** | Ouro vive em `characters.gold`, movido só por `core/transaction-service` |
| Criar item | **Não** | Item vive em `character_inventory`; `AddItem` local some no relog (`MODS_AND_GAMEMODE_CONTRACT` §2) |
| Teleporte, no-clip | **Não** | Cosmético para o servidor; o mundo não deriva estado disso |
| **Godmode, vida infinita** | **SIM** | `death-service.js:245` lê `getActorValue('Health')`. Vida que não cai = nunca entra em `DOWNED` |
| **Velocidade, stamina** | **SIM** | Mesmo caminho: ActorValue que o servidor lê |

**O contrato de mods já registra esta fronteira:** *mod não consegue criar estado, mas consegue mexer em ActorValue, e o servidor lê ActorValue.*

Então o problema real é estreito e nomeável: **manipulação de ActorValue**. Não é "trainers".

## 3. Problemas que a proposta cria

### 3.1 Detecta a coisa errada

O detector deles casa **nome** contra nove assinaturas (Cheat Engine, WeMod, PLITCH, ArtMoney, e um genérico para `trainer`). Isso responde *existe um programa com esse nome nesta máquina?* — e não *a vida deste personagem está sendo manipulada?*

Um jogador com Cheat Engine instalado há dois anos para um jogo single-player é sinalizado. Um jogador com godmode ativo por um mod caseiro não é.

### 3.2 Falso positivo é o custo que ninguém contabiliza

O padrão genérico casa com qualquer coisa: um mod `Combat Trainer.esp`, uma pasta `Personal Trainer`, um PDF de certificação. Eles sabem disso — existe uma opção para desligar o padrão genérico no código deles, o que é a confissão de que a heurística é ruidosa.

Falso positivo aqui não é ruído: é **acusar um jogador de trapaça**. Numa comunidade de RP, essa acusação sobrevive à retratação.

### 3.3 Contorno custa cinco segundos

Renomear o executável. É tudo. Quem trapaça de propósito passa; quem não trapaça é escaneado. **A ferramenta pune exatamente quem ela não deveria alcançar.**

### 3.4 Cria expectativa falsa de segurança

Pior que não ter: a staff passa a confiar que "o sistema pega" e para de olhar.

## 4. Exploits possíveis

- **Renomear o executável** — anula tudo.
- **Rodar de pendrive ou VM** — fora das raízes varridas.
- **Plantar falso positivo em terceiro.** Criar um arquivo com nome envenenado na pasta de outro jogador (Discord, pasta compartilhada, mod distribuído com esse arquivo dentro) e ele é sinalizado. **Um sistema de acusação automática vira arma.**
- **Envenenar o canal de relato.** O relatório vem do cliente; um cliente hostil manda o que quiser — inclusive relatório limpo, inclusive acusação forjada contra outro.

Este último é decisivo: **é um detector de cliente hostil cuja saída vem do cliente hostil.**

## 5. Impacto na economia

Nenhum, nos dois sentidos. A economia já é server-authoritative — foi por isso que o `economy-service` foi apagado. O scanner não protege o que já está protegido, e não alcança o que está exposto (ActorValue não é econômico).

## 6. Impacto político

Negativo e subestimado. Quem opera o detector decide quem é acusado. Sem processo, isso é poder sem contrapartida — exatamente o que a §5 da Constituição proíbe e o que a integração com a Chancelaria existe para resolver.

## 7. Impacto militar

O único lugar onde a ameaça real morde: godmode numa cena de combate destrói a cena e a confiança nela. **Mas o scanner não detecta godmode** — detecta instalação. O impacto militar justifica agir; não justifica *este* mecanismo.

## 8. Impacto religioso

Nenhum direto. Indireto se houver mecânica de alma ou corrupção lendo ActorValue: manipulação passaria a falsificar destino de personagem, o que sobe a aposta da §14.

## 9. Impacto social

**O maior risco do documento.** Comunidade de Heavy RP funciona por confiança. Um sistema que varre a máquina de todo mundo comunica desconfiança por padrão, e a primeira acusação errada custa mais que dez trapaças não detectadas.

Há um caminho social melhor e já existente: **o mundo percebe**. Alguém que sobrevive ao que deveria matá-lo é notado por quem estava na cena — e isso já vira denúncia com testemunha.

## 10. Impacto técnico

- **Raio de explosão máximo.** O launcher roda antes do jogo, com privilégio de usuário. É o pior lugar da nossa pilha para colocar algo invasivo.
- **PowerShell a cada 30 s** e varredura de milhares de arquivos a cada 10 min, na máquina de quem só quer jogar.
- **Canal de relato novo** = superfície nova de autenticação e de abuso.
- **LGPD.** Jogadores brasileiros, dado pessoal. Lista de aplicativos instalados é reveladora (software médico, apps de relacionamento, ferramentas de busca de emprego). Exige base legal, finalidade declarada, minimização e transparência. *É para anti-cheat* não é base legal automática.
- **Repositório público sob AGPL.** Publicaríamos o esqueleto de um programa que varre a máquina do usuário e reporta a um servidor remoto. Qualquer fork aponta o endpoint para onde quiser. A AGPL obriga a oferecer a fonte — mitiga, não elimina.

## 11. Impacto narrativo

Zero. Um scanner não produz história. É infraestrutura policial invisível.

## 12. Como gera histórias

**Não gera** — e pela §4 da Constituição isso basta para descartar *na forma proposta*.

A alternativa gera: vida que não cai vira **anomalia registrada**, que vira **prova**, que vira **processo** com testemunhas — mesmo caminho do `death:killer`. O trapaceiro deixa de ser um banimento silencioso e passa a ser um caso julgado, que a comunidade vê acontecer.

## 13. Como pode ser abusada

- **Por quem opera:** varredura de máquina de jogador é vigilância; sem finalidade estreita e auditada, vira consulta ao currículo alheio.
- **Por jogador contra jogador:** plantio de falso positivo (§4).
- **Por um fork:** nosso código público, endpoint deles, sem as nossas salvaguardas — e com a nossa reputação no nome do projeto.

## 14. Como balancear — o que fazemos em vez disso

### 14.1 O servidor observa o efeito, não a ferramenta

O `death-service` **já** lê `getActorValue('Health')` a cada 2 s. A checagem de plausibilidade pega carona no dado que já buscamos: **zero chamada Papyrus a mais** — o que importa, porque cada ida e volta custa 13–35 ms.

O que é implausível e o servidor vê sozinho:

- Vida que **não cai** enquanto o polling registra dano (o `checkDamageSpike` já existe).
- Vida que **sobe** sem evento de cura, poção ou descanso.
- Vida **acima do máximo** conhecido do personagem.
- Deslocamento por tick acima do limite físico.

Isso não é contornável renomeando arquivo. Detecta o efeito **independente da ferramenta** — trainer, mod caseiro, script, tanto faz.

### 14.2 Nunca banimento automático — evidência, como o `death:killer`

Anomalia vira linha em `audit_logs`, na categoria `cheating` que o [`MODERATION_WORKFLOW.md`](../admin/MODERATION_WORKFLOW.md) já prevê. **A staff julga.** É a mesma regra que já vale para autoria de morte: verdade OOC vai para quem julga, nunca vira sentença sozinha.

### 14.3 Janela de confirmação — a boa ideia deles, aproveitada

O detector deles exige **3 observações em 70 s** antes de acreditar, com cooldown de 6 h. Isso é engenharia honesta contra oscilação, e vale igual do lado do servidor: **nunca sinalizar por um tick estranho.** Rede, lag e o próprio jogo produzem leituras absurdas isoladas.

### 14.4 O meio-termo legítimo no cliente, se um dia for preciso

O launcher **já** calcula hash de arquivos para paridade de modpack, e o jogador já consentiu com isso ao entrar. Estender *essa* verificação — integridade da DLL do SKSE, plugin injetado no `Data/` — fica **dentro do envelope de consentimento que já existe**, não varre arquivo não relacionado, e é justificado pelo contrato de FormID.

Isso é diferente, em natureza, de listar os aplicativos instalados da pessoa.

## 15. Como integra ao resto do mundo

| Sistema | Ligação |
|---|---|
| `death-service` | Onde a checagem mora — o polling de vida já existe |
| `core/range-utils` | `nearbyActors()` já dá as testemunhas da cena |
| `audit_logs` | Onde a evidência pousa, categoria `cheating` |
| `MODERATION_WORKFLOW` | O fluxo de julgamento já está escrito |
| `governance-service` | Trapaça vira processo, não linchamento |
| Chancelaria Real | Prova anexável, com testemunha |
| Paridade de modpack | Onde cabe a única verificação de cliente legítima (§14.4) |

---

## Ordem recomendada

**Pré-requisito: Fase 0.** Não dá para calibrar limiar de plausibilidade sem uma sessão real — sem dado, qualquer número é chute, e chute em detecção de trapaça produz falso positivo.

1. **Medir antes de detectar.** Durante a Fase 0, registrar leituras de vida e deslocamento **sem julgar nada**. É o *threat model / telemetry* que o gap analysis pede.
2. **Plausibilidade de ActorValue** sobre o polling existente, com janela de confirmação, gravando em `audit_logs`.
3. **Integridade do SKSE** dentro da verificação de paridade que já existe (§14.4).
4. **Nunca** o scanner de processos e aplicativos instalados, salvo decisão explícita com base legal LGPD, aviso ao jogador e revisão humana obrigatória — e mesmo aí, não no repositório público.

## A decisão, em uma frase

> Detectamos **o efeito no servidor**, nunca **a ferramenta no cliente**. A primeira é inforjável e não custa privacidade; a segunda é contornada renomeando um arquivo e cobra a máquina inteira do jogador em troca.
