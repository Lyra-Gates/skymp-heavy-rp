# Auditoria de atomicidade do launch ticket

Data: 2026-08-12. Arquivo auditado: `apps/game-api/server.js`.

## Veredito

O consumo é atômico quanto a replay concorrente:

```sql
UPDATE launch_tickets
SET consumed_at = NOW()
WHERE token_hash = ?
  AND consumed_at IS NULL
  AND expires_at > NOW()
```

Somente a requisição cujo `affectedRows === 1` avança. InnoDB serializa updates concorrentes da mesma linha; as demais observam `consumed_at` preenchido e falham. Isso é superior a `SELECT` seguido de `UPDATE` sem lock.

## Limites

- Depois do update vencedor, a identidade é lida em um segundo statement. Uma remoção administrativa da linha entre statements faria o vencedor falhar fechado; não permite replay, mas produz consumo sem admissão.
- Launch grant e poll grant compartilham `launch_tickets` e o mesmo formato sem `kind/audience`. O contrato v1 separa semanticamente os dois.
- O teste atual é principalmente estrutural/unitário. Um teste MariaDB com duas conexões reais deve confirmar exatamente um vencedor.
- A emissão do game session ocorre depois da admissão; falha entre consumo e persistência exige novo login, mas não duplica identidade.

## Decisão

Não alterar `apps/game-api/` antes do retorno do Claude. Manter o UPDATE condicional como invariante e criar, na trilha dele, teste de integração com duas conexões MariaDB e transação explícita se a leitura da identidade for incorporada ao mesmo boundary.

## Cenário obrigatório

```text
ticket T válido
A e B chamam queue/join ao mesmo tempo
UPDATE de A -> affectedRows 1
UPDATE de B -> affectedRows 0
A resolve exatamente account X
B recebe invalid_ticket
uma única admissão/game session é criada
```
