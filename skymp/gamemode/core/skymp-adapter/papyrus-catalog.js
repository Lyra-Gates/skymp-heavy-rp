/**
 * core/skymp-adapter/papyrus-catalog.js
 *
 * As funcoes Papyrus que o servidor SkyMP realmente implementa.
 *
 * ─── Como esta lista foi feita, e por que ela existe ─────────────────────────
 *
 * Extraida de `skymp5-server/cpp/server_guest_lib/script_classes/Papyrus*.cpp`
 * no commit `d85f18d8` — as chamadas `AddMethod(vm, "Nome", …)` e
 * `AddStatic(vm, "Nome", …)`. Sao 128 registros.
 *
 * Chamar qualquer nome fora daqui **nao lanca**: o VM loga um erro e devolve
 * `VarValue::None()`, que chega ao JavaScript como `null`. E `null <= 0` e
 * `true`, entao uma funcao inexistente nao produz erro — produz decisao errada.
 *
 * Foi assim que `death-service.js` passou a derrubar todo jogador conectado em
 * dois segundos chamando `Actor.GetActorValue`, que nao existe. Ver
 * docs/research/SKYMP_INTEGRATION_AUDIT.md §4.
 *
 * ─── Esta lista envelhece ────────────────────────────────────────────────────
 *
 * Ela vale para um commit. Quando o pin de `patches/manifest.json` subir, ela
 * precisa ser refeita — o comando esta em
 * docs/technical/SKYMP_COMPATIBILITY_MATRIX.md §4.1.
 *
 * O adaptador prefere a reflexao em runtime (`mp._sp3GetFunctionImplementation`)
 * quando ela existe, justamente para nao depender deste arquivo. A lista e o
 * fallback, nao a autoridade.
 *
 * Nomes em minusculo porque o VM usa `CIString`: a busca e case-insensitive.
 */

'use strict';

/** Metodos — `callType: 'method'`. */
const METHODS = new Set([
  'actor.addspell',
  'actor.addtofaction',
  'actor.damageactorvalue',
  'actor.drawweapon',
  'actor.equipitem',
  'actor.equipitemex',
  'actor.equipspell',
  'actor.getactorvaluepercentage',
  'actor.getfactions',
  'actor.getnthspell',
  'actor.getrace',
  'actor.getsitstate',
  'actor.getspellcount',
  'actor.isdead',
  'actor.isequipped',
  'actor.isinfaction',
  'actor.isweapondrawn',
  'actor.playidle',
  'actor.removefromfaction',
  'actor.removespell',
  'actor.restoreactorvalue',
  'actor.setactorvalue',
  'actor.setalpha',
  'actor.setdontmove',
  'actor.unequipall',
  'actor.unequipitem',
  'actor.wornhaskeyword',
  'book.getspell',
  'cell.isattached',
  'cell.isinterior',
  'effectbase.play',
  'effectbase.stop',
  'faction.getreaction',
  'form.getformid',
  'form.getname',
  'form.gettype',
  'form.getweight',
  'form.haskeyword',
  'form.registerforsingleupdate',
  'formlist.find',
  'formlist.getat',
  'formlist.getsize',
  'leveledbase.getnthform',
  'message.show',
  'objectreference.activate',
  'objectreference.additem',
  'objectreference.blockactivation',
  'objectreference.delete',
  'objectreference.disable',
  'objectreference.disablenowait',
  'objectreference.enable',
  'objectreference.enablenowait',
  'objectreference.getallitemscount',
  'objectreference.getanimationvariablebool',
  'objectreference.getbaseobject',
  'objectreference.getdistance',
  'objectreference.getitemcount',
  'objectreference.getlinkedref',
  'objectreference.getnthlinkedref',
  'objectreference.getopenstate',
  'objectreference.getparentcell',
  'objectreference.getpositionx',
  'objectreference.getpositiony',
  'objectreference.getpositionz',
  'objectreference.getscale',
  'objectreference.gettotalitemweight',
  'objectreference.is3dloaded',
  'objectreference.isactivationblocked',
  'objectreference.iscontainerempty',
  'objectreference.isdeleted',
  'objectreference.isdisabled',
  'objectreference.isharvested',
  'objectreference.moveto',
  'objectreference.placeatme',
  'objectreference.playanimation',
  'objectreference.playanimationandwait',
  'objectreference.playgamebryoanimation',
  'objectreference.removeallitems',
  'objectreference.removeitem',
  'objectreference.setangle',
  'objectreference.setdisplayname',
  'objectreference.setopen',
  'objectreference.setposition',
  'objectreference.setscale',
  'potion.isfood',
  'quest.getcurrentstageid',
  'quest.getstage',
  'sound.play',
]);

/** Estaticas — `callType: 'global'`. */
const STATICS = new Set([
  'debug.messagebox',
  'debug.notification',
  'debug.sendanimationevent',
  'debug.trace',
  'game.disableplayercontrols',
  'game.enableplayercontrols',
  'game.findclosestreferenceofanytypeinlistfromref',
  'game.findclosestreferenceoftypefromref',
  'game.forcethirdperson',
  'game.getcamerastate',
  'game.getform',
  'game.getformex',
  'game.getplayer',
  'game.incrementstat',
  'game.shakecontroller',
  'game.showlimitedracemenu',
  'game.showracemenu',
  'keyword.getkeyword',
  'netimmerse.setnodescale',
  'netimmerse.setnodetextureset',
  'skymp.setdefaultactor',
  'utility.createaliasarray',
  'utility.createboolarray',
  'utility.createfloatarray',
  'utility.createformarray',
  'utility.createintarray',
  'utility.gametimetostring',
  'utility.getcurrentgametime',
  'utility.getcurrentrealtime',
  'utility.isinmenumode',
  'utility.randomfloat',
  'utility.randomint',
  'utility.resizealiasarray',
  'utility.resizeboolarray',
  'utility.resizefloatarray',
  'utility.resizeformarray',
  'utility.resizeintarray',
  'utility.wait',
  'utility.waitgametime',
  'utility.waitmenumode',
]);

/** Commit upstream de onde a lista foi extraida. */
const UPSTREAM_COMMIT = 'd85f18d808f877401c4e20484d2c2f6f73cf9caa';

/**
 * @param {'method'|'global'} callType
 * @param {string} className
 * @param {string} functionName
 * @returns {boolean}
 */
function isKnownPapyrusFunction(callType, className, functionName) {
  const chave = `${className}.${functionName}`.toLowerCase();
  if (callType === 'method') return METHODS.has(chave);
  if (callType === 'global') return STATICS.has(chave);
  return false;
}

module.exports = { METHODS, STATICS, UPSTREAM_COMMIT, isKnownPapyrusFunction };
