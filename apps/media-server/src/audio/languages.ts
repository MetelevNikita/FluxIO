/**
 * Токен `{язык}` из имени файла приводится к ISO 639-2/B — именно этот код уходит
 * в ISO_639_language_descriptor элементарного аудиопотока, по нему головная станция
 * отбирает дорожки. Таблица покрывает и коды, и названия языков, и латиницу, и
 * кириллицу; неизвестный токен становится `und`, но сохраняет исходную подпись.
 */
const languageAliases = new Map<string, string>([
  // русский
  ["rus", "rus"], ["ru", "rus"], ["russian", "rus"], ["рус", "rus"], ["русский", "rus"],
  // английский
  ["eng", "eng"], ["en", "eng"], ["english", "eng"], ["англ", "eng"], ["английский", "eng"],
  // испанский
  ["spa", "spa"], ["es", "spa"], ["spanish", "spa"], ["spain", "spa"], ["espanol", "spa"],
  ["español", "spa"], ["исп", "spa"], ["испанский", "spa"],
  // итальянский
  ["ita", "ita"], ["it", "ita"], ["italian", "ita"], ["italy", "ita"], ["italiano", "ita"],
  ["итал", "ita"], ["итальянский", "ita"],
  // немецкий
  ["ger", "ger"], ["deu", "ger"], ["de", "ger"], ["german", "ger"], ["germany", "ger"],
  ["deutsch", "ger"], ["нем", "ger"], ["немецкий", "ger"],
  // французский
  ["fre", "fre"], ["fra", "fre"], ["fr", "fre"], ["french", "fre"], ["france", "fre"],
  ["francais", "fre"], ["français", "fre"], ["фр", "fre"], ["французский", "fre"],
  // прочие частые
  ["ukr", "ukr"], ["uk", "ukr"], ["ukrainian", "ukr"], ["укр", "ukr"],
  ["kaz", "kaz"], ["kk", "kaz"], ["kazakh", "kaz"], ["каз", "kaz"],
  ["por", "por"], ["pt", "por"], ["portuguese", "por"], ["portugal", "por"],
  ["pol", "pol"], ["pl", "pol"], ["polish", "pol"], ["poland", "pol"],
  ["tur", "tur"], ["tr", "tur"], ["turkish", "tur"], ["turkey", "tur"],
  ["chi", "chi"], ["zho", "chi"], ["zh", "chi"], ["chinese", "chi"], ["china", "chi"],
  ["jpn", "jpn"], ["ja", "jpn"], ["japanese", "jpn"], ["japan", "jpn"],
  ["kor", "kor"], ["ko", "kor"], ["korean", "kor"], ["korea", "kor"],
  ["ara", "ara"], ["ar", "ara"], ["arabic", "ara"],
  ["hin", "hin"], ["hi", "hin"], ["hindi", "hin"],
  ["heb", "heb"], ["he", "heb"], ["hebrew", "heb"],
  ["nld", "dut"], ["dut", "dut"], ["nl", "dut"], ["dutch", "dut"],
  ["swe", "swe"], ["sv", "swe"], ["swedish", "swe"],
  ["ces", "cze"], ["cze", "cze"], ["cs", "cze"], ["czech", "cze"],
  ["srp", "srp"], ["sr", "srp"], ["serbian", "srp"],
  ["hye", "arm"], ["arm", "arm"], ["armenian", "arm"], ["арм", "arm"],
  ["kat", "geo"], ["geo", "geo"], ["georgian", "geo"], ["груз", "geo"],
  ["aze", "aze"], ["az", "aze"], ["azerbaijani", "aze"], ["азер", "aze"],
  ["uzb", "uzb"], ["uz", "uzb"], ["uzbek", "uzb"], ["узб", "uzb"],
  // явный «без языка»
  ["und", "und"], ["orig", "und"], ["original", "und"], ["ориг", "und"],
]);

export const undefinedLanguageCode = "und";

export function resolveLanguageCode(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (!normalized) return undefinedLanguageCode;

  const alias = languageAliases.get(normalized);
  if (alias) return alias;

  // Незнакомый трёхбуквенный токен уже похож на ISO 639-2 — берём как есть.
  if (/^[a-z]{3}$/.test(normalized)) return normalized;

  return undefinedLanguageCode;
}

/** Подпись для UI: исходный токен, но в компактном нижнем регистре. */
export function languageLabel(token: string): string {
  const normalized = token.trim().toLowerCase();
  return normalized.slice(0, 32) || undefinedLanguageCode;
}
