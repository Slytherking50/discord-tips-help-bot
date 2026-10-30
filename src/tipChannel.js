// a que canal va el proximo tip automatico. rankedChannelIds son los canales
// con actividad desde el ultimo tip, del mas al menos activo.
//
// - Con un canal fijo (config.tipsChannelId): solo ese, y solo si hubo actividad
//   ahi (no se le habla a un canal vacio).
// - Sin canal fijo: el mas activo que no este excluido.
function pickTipChannelId(config, rankedChannelIds) {
  if (config?.tipsChannelId) {
    return rankedChannelIds.includes(config.tipsChannelId) ? config.tipsChannelId : null;
  }
  const excluded = new Set(config?.tipsExcludedChannelIds || []);
  return rankedChannelIds.find((id) => !excluded.has(id)) || null;
}

module.exports = { pickTipChannelId };
