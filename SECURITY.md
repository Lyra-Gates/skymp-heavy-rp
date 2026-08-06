# Política de Segurança

***Português** · [English](SECURITY.en.md)*

Este projeto lida com autenticação de Discord, tickets de sessão, economia persistente e permissões de staff. Falha em qualquer um desses pontos afeta jogadores reais de qualquer servidor que use esta base.

## Reportando uma falha

**Não abra issue pública.** Uma issue de segurança aberta é um mapa para quem quiser explorar a falha antes de existir correção — e como esta é uma build pública, isso atinge outros servidores além do seu.

Use um destes canais:

- **[Security Advisory do GitHub](https://github.com/vinicius3232/skymp-heavy-rp/security/advisories/new)** — preferido, permite discussão privada e coordenação da divulgação.
- Contato direto com o mantenedor pelo Discord do projeto.

Ajuda muito incluir: onde está (serviço e arquivo), o que dá pra fazer explorando, e como reproduzir. Prova de conceito é bem-vinda, mas **não teste em servidor de terceiro** — só no seu.

## O que esperar

Não há SLA — o projeto é mantido por voluntários. O compromisso é: resposta assim que possível, correção priorizada acima de qualquer feature, e crédito a você no commit e no changelog, salvo se preferir anonimato.

Quando a correção sair, ela é publicada com descrição do impacto. Servidores rodando esta base precisam saber o que atualizar e por quê.

## No escopo

Coisas que queremos saber:

- Contornar whitelist, entrar sem aprovação, ou assumir a identidade de outro jogador
- Escalar privilégio de staff, ou executar comando de staff sem permissão
- Duplicar ouro ou item, ou qualquer forma de burlar o `core/transaction-service`
- Ler ou alterar dados de outro jogador (ficha, inventário, mensagens privadas)
- Vazar segredo do servidor pelo launcher, pelo painel ou pela UI in-game
- Injeção de SQL, XSS no painel ou na UI in-game
- Contornar a verificação de paridade de modpack
- Derrubar o servidor com requisição malformada

## Fora do escopo

- **Vulnerabilidades do próprio SkyMP** — reporte em [skyrim-multiplayer/skymp](https://github.com/skyrim-multiplayer/skymp). Se afetar o uso que fazemos dele, avise aqui também.
- **Cheat de cliente** (aimbot, speedhack, ESP). O cliente não é confiável por natureza; nossa defesa é o servidor não acreditar nele. Se você achou um jeito de fazer o **servidor** aceitar algo que o cliente inventou, aí **é** no escopo.
- Falhas que exigem acesso físico à máquina do servidor ou credencial já comprometida.
- Ataque de negação de serviço por volume bruto — isso é camada de infraestrutura.

## Limitações conhecidas

Transparência é mais útil que fingir cobertura completa. Estas são conhecidas e documentadas:

- **Nada foi validado numa sessão de jogo real.** Todo o gamemode está verificado só com `mp` mockado. Ver [QA_REPORT_2026-08.md](docs/technical/QA_REPORT_2026-08.md).
- **`offlineMode: true` desliga a autenticação.** Nesse modo o cliente declara o próprio `profileId` e o servidor acredita. É modo de laboratório; os exemplos vêm com `offlineMode: false`. Quem rodar servidor público em `offlineMode` não tem autenticação nenhuma.
- **Eventos de cliente são dica, não prova.** `mp.makeEventSource` roda no cliente. O servidor precisa validar tudo que vier de lá.

Se você encontrar algo que a documentação já reconhece, ainda vale reportar caso o impacto seja maior do que está descrito.

## Para quem opera um servidor com esta base

- Nunca versione `.env`. O `.gitignore` cobre, e o CI confere.
- Gere `SESSION_SECRET`, `INTERNAL_API_SECRET` e `MASTER_KEY` aleatórios e distintos por ambiente.
- Mantenha `GAME_API_BIND_HOST` e as portas internas atrás de firewall. Só o servidor de jogo e a API precisam ser alcançáveis de fora.
- Use `offlineMode: false` em produção. Sempre.
- Acompanhe `audit_logs` — ele existe para que abuso de staff seja detectável.
