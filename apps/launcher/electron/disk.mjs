/**
 * disk.mjs — espaço em disco antes de baixar, sem I/O
 *
 * Baixar modpack até o disco encher é rotina, e o modo de falha cru é
 * ilegível: o jogador recebe `ENOSPC: no space left on device` no meio de uma
 * barra de progresso e não sabe se o problema é dele, do servidor ou da
 * internet.
 *
 * Duas coisas que este módulo trata e que uma checagem ingênua erra:
 *
 * **O download e a instalação podem estar em discos diferentes.** O `.zip` vai
 * para `temp` e o conteúdo é extraído na pasta do jogo. Checar só um dos dois
 * deixa passar exatamente metade dos casos.
 *
 * **Não saber medir não é motivo para bloquear.** `statfs` pode faltar ou
 * falhar; nesse caso seguimos em frente. Impedir o jogador de jogar porque não
 * conseguimos ler o espaço livre seria pior que o problema original.
 */

/**
 * Folga além do necessário. A extração precisa de espaço temporário, e um
 * Windows com disco em zero absoluto passa a se comportar mal em coisas que
 * não têm nada a ver com o launcher.
 */
export const RESERVA_BYTES = 512 * 1024 * 1024;

/** @param {number} n */
export function formatarBytes(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) return '?';
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB'];
  let valor = n;
  let i = 0;
  while (valor >= 1024 && i < unidades.length - 1) { valor /= 1024; i++; }
  return `${valor.toFixed(valor >= 10 || i === 0 ? 0 : 1)} ${unidades[i]}`;
}

/**
 * `ENOSPC` é o código; a mensagem varia por plataforma e por locale, então
 * checar texto seria frágil. O texto entra só como rede de segurança para
 * erros que perderam o código no caminho (ex: reempacotados numa Promise).
 *
 * @param {unknown} err
 */
export function ehDiscoCheio(err) {
  if (!err) return false;
  const codigo = /** @type {any} */ (err).code;
  if (codigo === 'ENOSPC') return true;
  const texto = String(/** @type {any} */ (err).message || err);
  return /ENOSPC|no space left|espa[cç]o insuficiente/i.test(texto);
}

/**
 * Avalia se dá para prosseguir.
 *
 * @param {{rotulo: string, livreBytes: number|null, necessarioBytes: number}[]} destinos
 * @param {number} [reserva]
 * @returns {{ok: boolean, error?: string, naoMedido?: string[]}}
 */
export function avaliarEspaco(destinos, reserva = RESERVA_BYTES) {
  if (!Array.isArray(destinos) || destinos.length === 0) return { ok: true };

  const naoMedido = [];

  for (const destino of destinos) {
    const { rotulo, livreBytes, necessarioBytes } = destino;

    // Sem medida confiável, seguimos — ver o cabeçalho.
    if (typeof livreBytes !== 'number' || !isFinite(livreBytes)) {
      naoMedido.push(rotulo);
      continue;
    }
    if (typeof necessarioBytes !== 'number' || !isFinite(necessarioBytes) || necessarioBytes <= 0) {
      continue;
    }

    const exigido = necessarioBytes + reserva;
    if (livreBytes < exigido) {
      const faltam = exigido - livreBytes;
      return {
        ok: false,
        error:
          `Espace insuffisant sur ${rotulo} : ${formatarBytes(livreBytes)} sont disponibles, mais ` +
          `${formatarBytes(exigido)} sont nécessaires ` +
          `(${formatarBytes(necessarioBytes)} pour le téléchargement et ${formatarBytes(reserva)} de marge). ` +
          `Libérez ${formatarBytes(faltam)} puis réessayez.`
      };
    }
  }

  return naoMedido.length > 0 ? { ok: true, naoMedido } : { ok: true };
}
